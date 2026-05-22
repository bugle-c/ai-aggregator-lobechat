/**
 * GET /api/cron/payment-recovery-notify
 *
 * Runs every 5 minutes. For each failed/canceled billing_payments row from the
 * last 24 h (older than 5 min grace period), where the user has a
 * tg_bot_chat_id and no tg_recovery_sent mark yet, and no later succeeded
 * payment exists — sends a Telegram recovery DM via the bot.
 *
 * Primary channel: Telegram Invoice (sendInvoice) via bot T10 endpoint.
 * Fallback: signed URL buttons (SBP + any method).
 *
 * Anti-spam: max 1 DM per user per 24 h, max 3 per 7 days.
 */
import { eq, sql } from 'drizzle-orm';

import { billingPayments } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { appEnv } from '@/envs/app';
import { describeReason } from '@/server/modules/billing/cancellation-reasons';
import { signRecoveryToken } from '@/server/modules/billing/recovery-token';
import { fetchPlanById } from '@/server/services/billing/plans-source';

export const dynamic = 'force-dynamic';

interface BotResponse {
  channel?: 'invoice' | 'url_fallback';
  error?: string;
  sent: boolean;
  telegram_message_id?: number;
}

async function callBot(payload: Record<string, unknown>): Promise<BotResponse> {
  const url = process.env.BOT_INTERNAL_URL ?? 'http://127.0.0.1:8082';
  const token = process.env.BOT_INTERNAL_TOKEN;
  if (!token) return { sent: false, error: 'no_internal_token' };

  try {
    const res = await fetch(`${url}/internal/payment-recovery`, {
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json', 'X-Internal-Token': token },
      method: 'POST',
    });
    return (await res.json()) as BotResponse;
  } catch (err) {
    console.error('[payment-recovery-notify] bot call failed', err);
    return { sent: false, error: 'fetch_failed' };
  }
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return new Response('Unauthorized', { status: 401 });
  }

  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return Response.json({ ok: false, error: 'auth_secret_missing' }, { status: 500 });
  }

  const db = await getServerDB();
  const summary = { eligible: 0, sent: 0, blocked: 0, errors: 0, rateLimited: 0 };

  // Fetch eligible rows: failed/canceled in last 24h, older than 5min grace,
  // user has tg_bot_chat_id, no tg_recovery_sent yet, no later succeeded payment.
  const rows = await db.execute(sql`
    SELECT bp.id::text AS id,
           bp.user_id,
           bp.amount_rub,
           bp.plan_id,
           bp.tokens_amount,
           bp.type,
           bp.metadata,
           ub.tg_bot_chat_id
    FROM billing_payments bp
    JOIN user_billing ub ON ub.user_id = bp.user_id
    WHERE bp.status IN ('failed','canceled')
      AND bp.created_at > NOW() - INTERVAL '24 hours'
      AND bp.created_at < NOW() - INTERVAL '5 minutes'
      AND ub.tg_bot_chat_id IS NOT NULL
      AND (bp.metadata->>'tg_recovery_sent') IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM billing_payments bp2
        WHERE bp2.user_id = bp.user_id
          AND bp2.status = 'succeeded'
          AND bp2.created_at > bp.created_at
      )
    LIMIT 50
  `);

  const candidateRows = rows.rows as Array<{
    id: string;
    user_id: string;
    amount_rub: number;
    plan_id: number | null;
    tokens_amount: number | null;
    type: string;
    metadata: Record<string, unknown> | null;
    tg_bot_chat_id: string;
  }>;

  if (candidateRows.length === 0) {
    return Response.json({ ok: true, ...summary });
  }

  const userIds = candidateRows.map((r) => r.user_id);

  // Anti-spam caps: per user, max 1 sent in last 24h and max 3 in last 7d.
  //
  // NB: passing a JS array via Drizzle's sql template would serialize it
  // as a record (parens-quoted), which Postgres can't cast to text[] —
  // hence the "cannot cast type record to text[]" error. Wrap each id in
  // `sql` and join with comma so Drizzle produces a proper IN-list, then
  // use IN instead of ANY(...).
  const userIdList = sql.join(
    userIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const capRows = await db.execute(sql`
    SELECT user_id,
           COUNT(*) FILTER (WHERE (metadata->>'tg_recovery_sent') > to_char(NOW() - INTERVAL '24 hours','YYYY-MM-DD"T"HH24:MI:SS')) AS day_count,
           COUNT(*) FILTER (WHERE (metadata->>'tg_recovery_sent') > to_char(NOW() - INTERVAL '7 days','YYYY-MM-DD"T"HH24:MI:SS')) AS week_count
    FROM billing_payments
    WHERE user_id IN (${userIdList})
      AND (metadata->>'tg_recovery_sent') IS NOT NULL
      AND (metadata->>'tg_recovery_sent') <> 'blocked'
    GROUP BY user_id
  `);

  const caps = new Map<string, { day: number; week: number }>();
  for (const r of capRows.rows as Array<{
    user_id: string;
    day_count: string;
    week_count: string;
  }>) {
    caps.set(r.user_id, { day: Number(r.day_count), week: Number(r.week_count) });
  }

  for (const r of candidateRows) {
    summary.eligible++;
    const cap = caps.get(r.user_id) ?? { day: 0, week: 0 };
    if (cap.day >= 1 || cap.week >= 3) {
      summary.rateLimited++;
      continue;
    }

    const cancellation = (r.metadata?.cancellation ?? {}) as Record<string, unknown>;
    const reasonCode = (cancellation.reason as string | undefined) ?? 'unknown';
    const reasonDesc = describeReason(reasonCode);

    // Resolve plan name dynamically from plans-source (cached, 60s TTL)
    const plan = r.plan_id ? await fetchPlanById(r.plan_id) : undefined;
    const planName = plan?.name ?? 'Тариф';

    const expSec = Math.floor(Date.now() / 1000) + 24 * 3600;

    const tSbp = signRecoveryToken(
      { paymentId: r.id, userId: r.user_id, method: 'sbp', exp: expSec },
      secret,
    );
    const tAny = signRecoveryToken(
      { paymentId: r.id, userId: r.user_id, method: 'any', exp: expSec },
      secret,
    );

    const retryUrlSbp = `${appEnv.APP_URL}/api/billing/recovery-retry?payment=${r.id}&method=sbp&t=${tSbp}`;
    const retryUrlChoice = `${appEnv.APP_URL}/api/billing/recovery-retry?payment=${r.id}&method=any&t=${tAny}`;

    // Telegram invoice_payload has a 128-byte hard limit. An HMAC token
    // (base64url payload + signature) blows past it once paymentId and
    // userId are both UUIDs (~177 chars). Pass the bare paymentId (36
    // chars) instead — the bot→aggregator hop is already authenticated
    // by X-Internal-Token in /telegram-payment-fulfill, so the HMAC is
    // redundant here. The aggregator verifies ownership by joining
    // billing_payments.id → user_billing.tg_bot_chat_id == tg_user_id.
    const tInvoice = r.id;

    const result = await callBot({
      tg_chat_id: Number(r.tg_bot_chat_id),
      payment_id: r.id,
      amount_rub: r.amount_rub,
      plan_name: planName,
      tokens_amount: r.tokens_amount ?? 0,
      reason_code: reasonCode,
      reason_text: reasonDesc.text,
      invoice: {
        title: r.type === 'subscription' ? `Подписка ${planName} (повтор)` : `Пополнение (повтор)`,
        description:
          r.type === 'subscription'
            ? `Возобновление подписки ${planName}. ${r.tokens_amount ?? 0} кредитов.`
            : `${r.tokens_amount ?? 0} кредитов. Пополнение баланса.`,
        payload: tInvoice,
        currency: 'RUB' as const,
        prices: [{ label: planName, amount: r.amount_rub * 100 }], // kopecks
      },
      retry_url_sbp: retryUrlSbp,
      retry_url_choice: retryUrlChoice,
    });

    if (result.sent) {
      summary.sent++;
      await db
        .update(billingPayments)
        .set({
          metadata: sql`COALESCE(${billingPayments.metadata}, '{}'::jsonb) || ${JSON.stringify({
            tg_recovery_sent: new Date().toISOString(),
          })}::jsonb`,
          updatedAt: new Date(),
        })
        .where(eq(billingPayments.id, r.id));
    } else if (result.error === 'blocked') {
      summary.blocked++;
      await db
        .update(billingPayments)
        .set({
          metadata: sql`COALESCE(${billingPayments.metadata}, '{}'::jsonb) || ${JSON.stringify({
            tg_recovery_sent: 'blocked',
          })}::jsonb`,
          updatedAt: new Date(),
        })
        .where(eq(billingPayments.id, r.id));
    } else if (result.error === 'rate_limited') {
      summary.rateLimited++;
    } else {
      summary.errors++;
    }
  }

  return Response.json({ ok: true, ...summary });
}
