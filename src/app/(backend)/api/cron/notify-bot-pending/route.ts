/**
 * GET /api/cron/notify-bot-pending
 *
 * Sweeps billing_payments where bot_notify_pending = true and delivers
 * subscription_active notifications to the Telegram bot via its internal
 * HTTP endpoint. Runs on a short interval (e.g. every minute via host cron).
 *
 * Success (200 or 410 from bot) → marks bot_notify_pending=false.
 * Transient failure (5xx / network error) → leaves pending for next tick.
 */
import { and, eq, isNotNull } from 'drizzle-orm';

import { billingPayments, userBilling } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { fetchPlanById } from '@/server/services/billing/plans-source';

const BOT_BASE_URL = process.env.BOT_INTERNAL_URL ?? 'http://127.0.0.1:8081';
const BATCH_LIMIT = 100;

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const db = await getServerDB();

  // Fetch pending payments where the user has a tg_bot_chat_id registered.
  const pending = await db
    .select({
      paymentId: billingPayments.id,
      planId: billingPayments.planId,
      tgBotChatId: userBilling.tgBotChatId,
    })
    .from(billingPayments)
    .innerJoin(userBilling, eq(userBilling.userId, billingPayments.userId))
    .where(and(eq(billingPayments.botNotifyPending, true), isNotNull(userBilling.tgBotChatId)))
    .limit(BATCH_LIMIT);

  let processed = 0;
  let errors = 0;

  // Compute expiry date: 30 days from now (mirrors fulfill.ts logic).
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);
  const expiresAtIso = expiresAt.toISOString();

  for (const row of pending) {
    const plan = row.planId ? await fetchPlanById(row.planId) : undefined;

    try {
      const res = await fetch(`${BOT_BASE_URL}/internal/notify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.BOT_NOTIFY_SECRET ?? ''}`,
        },
        body: JSON.stringify({
          tgUserId: row.tgBotChatId,
          type: 'subscription_active',
          payload: {
            planName: plan?.name ?? 'Unknown',
            expiresAt: expiresAtIso,
            creditsAdded: plan?.tokenLimit ?? 0,
          },
        }),
      });

      if (res.ok || res.status === 410) {
        // 200 = delivered, 410 = user blocked bot (never retry).
        await db
          .update(billingPayments)
          .set({
            botNotifyPending: false,
            botNotifiedAt: new Date(),
          })
          .where(eq(billingPayments.id, row.paymentId));
        processed++;
      } else {
        // 5xx or other — leave pending for next tick.
        console.warn(
          `[notify-bot-pending] Bot returned ${res.status} for payment ${row.paymentId}; will retry`,
        );
        errors++;
      }
    } catch (err) {
      // Network error — treat as 5xx: leave pending.
      console.error(`[notify-bot-pending] fetch error for payment ${row.paymentId}:`, err);
      errors++;
    }
  }

  return Response.json({ processed, errors });
}
