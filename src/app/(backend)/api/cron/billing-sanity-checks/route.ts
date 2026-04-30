/**
 * Hourly billing sanity-check cron.
 *
 * Surfaces financial anomalies that "shouldn't happen" after the
 * pre-charge + atomic write changes shipped in earlier billing
 * packages. Each individual check is wrapped in its own try/catch so
 * one broken probe never silences the others.
 *
 * Checks:
 *   A) negative-balances     — users in red or way past their plan limit
 *   B) markup-sanity         — admin typo: markup outside 1.5x..10x
 *   C) reconciliation        — booked usage_logs.cost_usd vs API rate
 *                              sanity (drift detection — coarse)
 *   D) stuck-async-tasks     — video tasks pending/processing > 1h
 *
 * Triggered from a host-level cron: see tasks/cron/billing-sanity-host.cron.
 */
import { AsyncTaskStatus } from '@lobechat/types';
import { and, count, eq, inArray, lt, or, sql } from 'drizzle-orm';

import { asyncTasks, billingPlans, usageLogs, userBilling } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { sendAlert } from '@/server/services/alerts';
import { fetchAllRates } from '@/server/services/billing/rates-source';

type CheckSeverity = 'ok' | 'warning' | 'critical' | 'error';

interface CheckResult {
  details?: unknown;
  error?: string;
  name: string;
  severity: CheckSeverity;
}

const STUCK_TASK_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
const STUCK_TASK_ALERT_THRESHOLD = 5;

// Markup outside this range is almost certainly an admin typo
// (e.g. forgot the decimal point — `30` instead of `3.0`).
const MARKUP_MIN = 1.5;
const MARKUP_MAX = 10;

export async function POST(req: Request) {
  const auth = req.headers.get('authorization');
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const db = await getServerDB();
  const checks: CheckResult[] = [];

  // --- A) negative-balances -------------------------------------------------
  // Conditions that should never be true post-precharge:
  //   * tokens_used_month < 0
  //   * tokens_used_month > plan.token_limit + token_balance + 100
  //     (small tolerance for rounding / inflight charges)
  try {
    const overshootRows = await db
      .select({
        planId: userBilling.planId,
        planTokenLimit: billingPlans.tokenLimit,
        tokenBalance: userBilling.tokenBalance,
        tokensUsedMonth: userBilling.tokensUsedMonth,
        userId: userBilling.userId,
      })
      .from(userBilling)
      .innerJoin(billingPlans, eq(billingPlans.id, userBilling.planId))
      .where(
        or(
          lt(userBilling.tokensUsedMonth, 0),
          sql`${userBilling.tokensUsedMonth} > ${billingPlans.tokenLimit} + ${userBilling.tokenBalance} + 100`,
        ),
      )
      .limit(50);

    if (overshootRows.length > 0) {
      const body = overshootRows
        .map(
          (r) =>
            `- ${r.userId}: used=${r.tokensUsedMonth} balance=${r.tokenBalance} planLimit=${r.planTokenLimit} (planId=${r.planId})`,
        )
        .join('\n');
      checks.push({
        details: overshootRows,
        name: 'negative-balances',
        severity: 'critical',
      });
      await sendAlert({
        body,
        severity: 'critical',
        title: `${overshootRows.length} users with negative or overshoot balance`,
      });
    } else {
      checks.push({ name: 'negative-balances', severity: 'ok' });
    }
  } catch (err) {
    checks.push({
      error: err instanceof Error ? err.message : String(err),
      name: 'negative-balances',
      severity: 'error',
    });
  }

  // --- B) markup-sanity -----------------------------------------------------
  // Read via the existing rates-source cache so we don't open a second
  // Supabase connection. fetchAllRates() returns active rates only.
  try {
    const rates = await fetchAllRates();
    const offenders = rates.filter(
      (r) => !Number.isFinite(r.markup) || r.markup < MARKUP_MIN || r.markup > MARKUP_MAX,
    );
    if (offenders.length > 0) {
      const body = offenders
        .map((r) => `- ${r.modelId} (${r.provider}): markup=${r.markup}`)
        .join('\n');
      checks.push({
        details: offenders.map((r) => ({
          markup: r.markup,
          modelId: r.modelId,
          provider: r.provider,
        })),
        name: 'markup-sanity',
        severity: 'warning',
      });
      await sendAlert({
        body,
        severity: 'warning',
        title: `${offenders.length} model rates with suspicious markup (<${MARKUP_MIN}x or >${MARKUP_MAX}x)`,
      });
    } else {
      checks.push({ name: 'markup-sanity', severity: 'ok' });
    }
  } catch (err) {
    checks.push({
      error: err instanceof Error ? err.message : String(err),
      name: 'markup-sanity',
      severity: 'error',
    });
  }

  // --- C) reconciliation (coarse) -------------------------------------------
  // We don't have manual_expenses in this DB yet; perform a lighter sanity
  // probe — flag if any usage_logs row this month has cost_usd <= 0 with
  // creditsCharged > 0 (meaning we charged the user but recorded zero
  // upstream cost — likely a rate-source miss / bug).
  try {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const zeroCostRows = await db
      .select({
        creditsCharged: usageLogs.creditsCharged,
        id: usageLogs.id,
        model: usageLogs.model,
        provider: usageLogs.provider,
        userId: usageLogs.userId,
      })
      .from(usageLogs)
      .where(
        and(
          sql`${usageLogs.createdAt} >= ${monthStart.toISOString()}`,
          sql`${usageLogs.costUsd}::numeric <= 0`,
          sql`${usageLogs.creditsCharged} > 0`,
        ),
      )
      .limit(20);

    if (zeroCostRows.length > 0) {
      const body = zeroCostRows
        .map(
          (r) =>
            `- log=${r.id} user=${r.userId} model=${r.model} provider=${r.provider} credits=${r.creditsCharged}`,
        )
        .join('\n');
      checks.push({
        details: zeroCostRows,
        name: 'reconciliation',
        severity: 'warning',
      });
      await sendAlert({
        body,
        severity: 'warning',
        title: `${zeroCostRows.length} usage_logs rows with credits charged but cost_usd <= 0`,
      });
    } else {
      checks.push({ name: 'reconciliation', severity: 'ok' });
    }
  } catch (err) {
    checks.push({
      error: err instanceof Error ? err.message : String(err),
      name: 'reconciliation',
      severity: 'error',
    });
  }

  // --- D) stuck-async-tasks -------------------------------------------------
  try {
    const cutoff = new Date(Date.now() - STUCK_TASK_THRESHOLD_MS);
    const [{ stuckCount }] = await db
      .select({ stuckCount: count() })
      .from(asyncTasks)
      .where(
        and(
          eq(asyncTasks.type, 'video_generation'),
          inArray(asyncTasks.status, [AsyncTaskStatus.Pending, AsyncTaskStatus.Processing]),
          lt(asyncTasks.createdAt, cutoff),
        ),
      );

    const stuck = Number(stuckCount ?? 0);

    if (stuck > STUCK_TASK_ALERT_THRESHOLD) {
      checks.push({
        details: { count: stuck, thresholdMs: STUCK_TASK_THRESHOLD_MS },
        name: 'stuck-async-tasks',
        severity: 'warning',
      });
      await sendAlert({
        body: `${stuck} video tasks are pending/processing for >1h. Cron polling may be broken or the upstream provider is degraded.`,
        severity: 'warning',
        title: `${stuck} stuck async video tasks (>1h)`,
      });
    } else {
      checks.push({
        details: { count: stuck },
        name: 'stuck-async-tasks',
        severity: 'ok',
      });
    }
  } catch (err) {
    checks.push({
      error: err instanceof Error ? err.message : String(err),
      name: 'stuck-async-tasks',
      severity: 'error',
    });
  }

  // --- E) billing-coverage --------------------------------------------------
  // Catches the class of bug where the chat path is silently bypassing
  // recordTokenUsage (AgentRuntime/RuntimeExecutors refactor in upstream
  // LobeChat slipped through 2026-04 — 341 messages, 5 usage_logs rows
  // before the leak was caught). Compares assistant messages vs usage_logs
  // rows in the last hour. Anything below `MIN_COVERAGE_RATIO` while there
  // is non-trivial traffic is alerted as critical.
  try {
    const coverageRows = await db.execute(sql`
      WITH msg AS (
        SELECT count(*)::int AS n
        FROM messages
        WHERE role = 'assistant'
          AND created_at > now() - interval '1 hour'
          AND model IS NOT NULL
      ),
      usg AS (
        SELECT count(*)::int AS n
        FROM usage_logs
        WHERE created_at > now() - interval '1 hour'
      )
      SELECT msg.n AS msgs, usg.n AS logs FROM msg, usg
    `);
    const row = (coverageRows as unknown as Array<{ msgs: number; logs: number }>)[0];
    const msgs = Number(row?.msgs ?? 0);
    const logs = Number(row?.logs ?? 0);
    const MIN_TRAFFIC = 5; // don't alert at low volume — too noisy
    const MIN_COVERAGE_RATIO = 0.5;
    const ratio = msgs > 0 ? logs / msgs : 1;
    if (msgs >= MIN_TRAFFIC && ratio < MIN_COVERAGE_RATIO) {
      checks.push({
        details: { messages: msgs, ratio, usageLogs: logs },
        name: 'billing-coverage',
        severity: 'critical',
      });
      await sendAlert({
        body: `Billing pipeline silently dropping rows.\n\nLast hour:\n  assistant messages: ${msgs}\n  usage_logs rows:    ${logs}\n  coverage ratio:     ${(ratio * 100).toFixed(1)}%\n\nThreshold: <${MIN_COVERAGE_RATIO * 100}% coverage at ≥${MIN_TRAFFIC} msgs/h is a leak — every message charges OpenRouter without debiting the user.`,
        severity: 'critical',
        title: '🚨 Billing coverage gap — chat bypassing usage_logs',
      });
    } else {
      checks.push({
        details: { messages: msgs, ratio, usageLogs: logs },
        name: 'billing-coverage',
        severity: 'ok',
      });
    }
  } catch (err) {
    checks.push({
      error: err instanceof Error ? err.message : String(err),
      name: 'billing-coverage',
      severity: 'error',
    });
  }

  return Response.json({
    checks,
    scannedAt: new Date().toISOString(),
  });
}
