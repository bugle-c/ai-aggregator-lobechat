/**
 * GET /api/cron/notify-bot-pending
 *
 * Sweeps two tables for pending bot notifications:
 *
 * 1. billing_payments WHERE bot_notify_pending = true → delivers subscription_active
 * 2. user_billing WHERE bot_notify_pending = true → delivers subscription_expiring,
 *    zero_credits, or usage_warning (based on bot_notify_type column)
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

/**
 * Compute how many days until the next monthly credit reset.
 * The billing cycle resets 30 days after `monthStart`.
 */
function daysUntilNextMonthReset(monthStart: Date | null): number {
  if (!monthStart) return 0;
  const resetAt = new Date(monthStart.getTime() + 30 * 86_400_000);
  const msLeft = resetAt.getTime() - Date.now();
  return Math.max(0, Math.ceil(msLeft / 86_400_000));
}

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

  // -------------------------------------------------------------------------
  // Sweep user_billing.bot_notify_pending — types: subscription_expiring,
  // zero_credits, usage_warning
  // -------------------------------------------------------------------------
  const userPending = await db
    .select({
      userId: userBilling.userId,
      notifyType: userBilling.botNotifyType,
      tgBotChatId: userBilling.tgBotChatId,
      planId: userBilling.planId,
      subscriptionExpiresAt: userBilling.subscriptionExpiresAt,
      tokenBalance: userBilling.tokenBalance,
      tokensUsedMonth: userBilling.tokensUsedMonth,
      monthStart: userBilling.monthStart,
    })
    .from(userBilling)
    .where(and(eq(userBilling.botNotifyPending, true), isNotNull(userBilling.tgBotChatId)))
    .limit(BATCH_LIMIT);

  for (const row of userPending) {
    const plan = row.planId ? await fetchPlanById(row.planId) : undefined;
    let payload: Record<string, unknown>;

    switch (row.notifyType) {
      case 'subscription_expiring': {
        payload = {
          planName: plan?.name ?? '?',
          expiresAt: row.subscriptionExpiresAt?.toISOString() ?? new Date().toISOString(),
        };
        break;
      }
      case 'zero_credits': {
        payload = { daysToReset: daysUntilNextMonthReset(row.monthStart) };
        break;
      }
      case 'usage_warning': {
        const expires = row.subscriptionExpiresAt;
        const daysLeft = expires
          ? Math.max(0, Math.ceil((expires.getTime() - Date.now()) / 86_400_000))
          : 0;
        payload = { planName: plan?.name ?? '?', daysLeft };
        break;
      }
      default: {
        // Unknown type — clear flag so we don't retry forever
        console.warn(
          `[notify-bot-pending] Unknown botNotifyType "${row.notifyType}" for user ${row.userId}; clearing flag`,
        );
        await db
          .update(userBilling)
          .set({ botNotifyPending: false, botNotifyType: null })
          .where(eq(userBilling.userId, row.userId));
        continue;
      }
    }

    try {
      const res = await fetch(`${BOT_BASE_URL}/internal/notify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.BOT_NOTIFY_SECRET ?? ''}`,
        },
        body: JSON.stringify({ tgUserId: row.tgBotChatId, type: row.notifyType, payload }),
      });

      if (res.ok || res.status === 410) {
        // 200 = delivered, 410 = user blocked bot (never retry).
        await db
          .update(userBilling)
          .set({ botNotifyPending: false, botNotifyType: null })
          .where(eq(userBilling.userId, row.userId));
        processed++;
      } else {
        console.warn(
          `[notify-bot-pending] Bot returned ${res.status} for user ${row.userId} (${row.notifyType}); will retry`,
        );
        errors++;
      }
    } catch (err) {
      console.error(
        `[notify-bot-pending] fetch error for user ${row.userId} (${row.notifyType}):`,
        err,
      );
      errors++;
    }
  }

  return Response.json({ processed, errors });
}
