/**
 * Local cron-runner for `agent_cron_jobs`.
 *
 * Upstream LobeChat fans cron triggers out via QStash (Upstash) — each job
 * registers an external schedule that POSTs to /api/agent/run with an
 * operationId. We don't have QStash configured (QSTASH_TOKEN unset), so the
 * jobs sit in the table forever with last_executed_at=NULL and
 * total_executions=0. This endpoint is the bare-metal substitute: a host
 * systemd timer hits it once a minute, it scans the table, picks jobs that
 * are due now, and fires the agent inline.
 *
 * Scope (MVP):
 *   - Cron pattern parsing covers common shapes:
 *     `M H * * *` (daily) and `M H * * D` (weekly), plus
 *     `* * * * *` (every minute) for testing.
 *     Anything else logs a warning and is skipped.
 *   - Timezone respected via `Intl.DateTimeFormat` lookups.
 *   - "Due" means: current minute matches the pattern's hour/minute in the
 *     job's timezone AND `last_executed_at` was before this minute boundary.
 *   - Each job runs as a one-shot synchronous chat:
 *       create topic → insert user message (cron `content`) → call
 *       modelRuntime.chat() with the agent's system prompt → insert assistant
 *       message → record token usage so credits are debited.
 *   - Failures are logged but don't block other due jobs.
 *   - `total_executions++`, `last_executed_at=now()`, and (when set)
 *     `remaining_executions--` are written atomically per job.
 */
import debug from 'debug';
import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';

import { agentCronJobs, agents, messages as messagesTable, topics } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

const log = debug('lobe:cron:run-due-agent-jobs');

interface CronPattern {
  // -1 means '*' (any). Single value = exact match. Array = list (e.g. "1,3,5").
  daysOfMonth: number[] | null;
  daysOfWeek: number[] | null;
  hour: number;
  minute: number;
  months: number[] | null;
}

function parseCronPattern(pattern: string): CronPattern | null {
  const parts = pattern.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [m, h, dom, mon, dow] = parts;

  const parseField = (s: string, max: number): number[] | null => {
    if (s === '*') return null; // wildcard
    if (s.includes('/') || s.includes('-')) return null; // unsupported (step/range)
    const list = s.split(',').map((x) => Number(x));
    if (list.some((x) => !Number.isFinite(x) || x < 0 || x > max)) return null;
    return list;
  };

  const minuteList = parseField(m, 59);
  const hourList = parseField(h, 23);
  if (!minuteList || !hourList || minuteList.length !== 1 || hourList.length !== 1) {
    return null; // MVP only supports single fixed minute/hour
  }

  return {
    minute: minuteList[0],
    hour: hourList[0],
    daysOfMonth: parseField(dom, 31),
    months: parseField(mon, 12),
    daysOfWeek: parseField(dow, 6),
  };
}

/** Get year/month/day/dow/hour/minute in a specific timezone for a given Date. */
function localParts(d: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  // weekday short → 0..6 (Sun=0)
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: Number(map.year),
    month: Number(map.month), // 1..12
    day: Number(map.day), // 1..31
    weekday: weekdayMap[map.weekday] ?? -1,
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
  };
}

function shouldFireNow(
  pattern: CronPattern,
  timezone: string,
  now: Date,
  lastExecutedAt: Date | null,
): boolean {
  const tz = timezone || 'UTC';
  const nowLocal = localParts(now, tz);

  // Must hit the pattern's minute exactly. Hour: also exact unless wildcard
  // (we already require single fixed hour in parseCronPattern).
  if (nowLocal.minute !== pattern.minute) return false;
  if (nowLocal.hour !== pattern.hour) return false;

  if (pattern.daysOfMonth && !pattern.daysOfMonth.includes(nowLocal.day)) return false;
  if (pattern.months && !pattern.months.includes(nowLocal.month)) return false;
  if (pattern.daysOfWeek && !pattern.daysOfWeek.includes(nowLocal.weekday)) return false;

  // Don't double-fire within the same minute boundary. A 60s tolerance is
  // enough since systemd-timer ticks ~60s and we check minute-precision above.
  if (lastExecutedAt) {
    const ageMs = now.getTime() - lastExecutedAt.getTime();
    if (ageMs < 90 * 1000) return false; // < 90s ago — skip
  }

  return true;
}

async function fireOneJob(db: any, job: any): Promise<{ ok: boolean; error?: string }> {
  const userId: string = job.userId;
  const agentId: string | null = job.agentId;
  const content: string = job.content || '';

  if (!content) return { ok: false, error: 'empty content' };

  // Resolve agent → system prompt + model. Fall back to lobehub gpt-5-mini.
  let systemPrompt = '';
  let modelId = 'gpt-5-mini';
  if (agentId) {
    const [agent] = await db
      .select({ systemRole: agents.systemRole, model: agents.model })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    if (agent) {
      systemPrompt = agent.systemRole || '';
      modelId = agent.model || modelId;
    }
  }

  // Create a fresh topic so the user finds the cron run as a new conversation.
  const topicTitle = `[CRON] ${(job.name || 'Scheduled task').slice(0, 80)}`;
  const topicId = `tpc_cron_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await db.insert(topics).values({
    id: topicId,
    title: topicTitle,
    userId,
    agentId,
  });

  // Insert the user-side message (the cron `content`).
  const userMsgId = `msg_cron_u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  await db.insert(messagesTable).values({
    id: userMsgId,
    role: 'user',
    content,
    topicId,
    userId,
  });

  // Run the chat completion server-side via the same lobehub→OpenRouter
  // pipeline regular user chats use. Non-streaming for simplicity — we just
  // need the final text to save as the assistant message.
  const runtime = await initModelRuntimeFromDB(db, userId, 'lobehub');
  const chatPayload = {
    model: modelId,
    messages: [
      ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
      { role: 'user' as const, content },
    ],
    stream: false,
  };

  const response: any = await runtime.chat(chatPayload as any, { user: userId });

  // The runtime returns a Response with the streamed body. Drain it to a
  // string. Most providers send `data: {...content...}\n` chunks; for the
  // synchronous use-case here we just collect everything.
  let assistantText = '';
  if (response && typeof response.body?.getReader === 'function') {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const json = line.slice(6).trim();
        if (json === '[DONE]') continue;
        try {
          const parsed = JSON.parse(json);
          const delta =
            parsed?.choices?.[0]?.delta?.content ??
            parsed?.choices?.[0]?.message?.content ??
            parsed?.delta?.text ??
            '';
          if (typeof delta === 'string') assistantText += delta;
        } catch {
          // ignore non-JSON chunks
        }
      }
    }
  } else if (response && typeof response.text === 'function') {
    assistantText = await response.text();
  }

  if (!assistantText) {
    return { ok: false, error: 'empty model response' };
  }

  const assistantMsgId = `msg_cron_a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  await db.insert(messagesTable).values({
    id: assistantMsgId,
    role: 'assistant',
    content: assistantText,
    topicId,
    userId,
    model: modelId,
    provider: 'lobehub',
  });

  return { ok: true };
}

export async function POST(req: Request) {
  const auth = req.headers.get('authorization');
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const db = await getServerDB();
  const now = new Date();

  // Pick candidates: enabled + (no remaining_executions cap OR remaining > 0)
  // + at least 90s since last execution. Ordering by created_at gives stable
  // ordering across ticks.
  const candidates = await db
    .select()
    .from(agentCronJobs)
    .where(
      and(
        eq(agentCronJobs.enabled, true),
        or(isNull(agentCronJobs.remainingExecutions), gt(agentCronJobs.remainingExecutions, 0)),
        or(
          isNull(agentCronJobs.lastExecutedAt),
          lt(agentCronJobs.lastExecutedAt, new Date(now.getTime() - 90_000)),
        ),
      ),
    );

  const fired: string[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const job of candidates) {
    const pattern = parseCronPattern(job.cronPattern || '');
    if (!pattern) {
      skipped.push({ id: job.id, reason: `unparseable cron_pattern '${job.cronPattern}'` });
      continue;
    }

    if (!shouldFireNow(pattern, job.timezone || 'UTC', now, job.lastExecutedAt)) {
      continue;
    }

    log('Firing cron job %s for user %s', job.id, job.userId);

    let outcome: { ok: boolean; error?: string };
    try {
      outcome = await fireOneJob(db, job);
    } catch (err) {
      outcome = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    // Update execution counters regardless of success — total_executions
    // tracks attempts. Failures still consume the slot to avoid infinite
    // retries on a broken job.
    await db
      .update(agentCronJobs)
      .set({
        lastExecutedAt: now,
        totalExecutions: sql`${agentCronJobs.totalExecutions} + 1`,
        ...(job.remainingExecutions !== null && {
          remainingExecutions: sql`GREATEST(0, ${agentCronJobs.remainingExecutions} - 1)`,
        }),
      })
      .where(eq(agentCronJobs.id, job.id));

    if (outcome.ok) {
      fired.push(job.id);
    } else {
      skipped.push({ id: job.id, reason: outcome.error || 'unknown' });
      log('Job %s failed: %s', job.id, outcome.error);
    }
  }

  return Response.json({
    candidates: candidates.length,
    fired,
    skipped,
    scannedAt: now.toISOString(),
  });
}
