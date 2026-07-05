/**
 * Default-model health-guard cron.
 *
 * Every run pings the platform default model (DEFAULT_MODEL via the
 * `lobehub` provider) with a minimal non-stream chat call on behalf of
 * a dedicated healthcheck user. If the call fails, a CRITICAL Telegram
 * alert is sent containing the ready-to-run repoint SQL, so an operator
 * can move affected users to a working provider within a minute.
 *
 * Triggered from a host-level cron every 15 minutes:
 *   curl -m 55 -H "Authorization: Bearer $CRON_SECRET" .../api/cron/model-health
 */
import { DEFAULT_MODEL } from '@lobechat/const';
import { NextResponse } from 'next/server';

import { getServerDB } from '@/database/server';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { sendAlert } from '@/server/services/alerts';

export const maxDuration = 60;

const PROVIDER = 'lobehub';

const REPOINT_SQL = `UPDATE user_settings SET default_agent = jsonb_set(jsonb_set(default_agent,'{config,model}','"gpt-5-mini"'),'{config,provider}','"lobehub"') WHERE default_agent->'config'->>'provider' NOT IN ('lobehub','openrouter');`;

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const userId = process.env.HEALTHCHECK_USER_ID;
  if (!userId) {
    return NextResponse.json({ error: 'HEALTHCHECK_USER_ID unset' }, { status: 500 });
  }

  try {
    const db = await getServerDB();
    const runtime = await initModelRuntimeFromDB(db, userId, PROVIDER);

    // Minimal non-stream ping. A small max_tokens budget (not 1) because
    // reasoning models spend tokens on reasoning before emitting content
    // and some providers reject too-small budgets outright.
    const response = await runtime.chat({
      max_tokens: 16,
      messages: [{ content: 'ping', role: 'user' }],
      model: DEFAULT_MODEL,
      responseMode: 'json',
      stream: false,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`);
    }

    return NextResponse.json({ model: DEFAULT_MODEL, ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);

    await sendAlert({
      body: `Дефолтная модель ${DEFAULT_MODEL}/${PROVIDER} НЕ отвечает: ${msg.slice(0, 300)}\n\nЕсли повторится 2 раза подряд — новые юзеры получают мёртвый чат. Repoint SQL:\n${REPOINT_SQL}`,
      severity: 'critical',
      title: `MODEL HEALTH: ${DEFAULT_MODEL} down`,
    });

    return NextResponse.json({ error: msg, ok: false }, { status: 502 });
  }
}
