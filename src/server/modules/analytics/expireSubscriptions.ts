import { and, eq, gte, isNotNull, isNull, lt, lte, not, or, sql } from 'drizzle-orm';

import { billingSubscriptionEvents } from '@/database/schemas/analytics';
import { userBilling } from '@/database/schemas/billing';
import { type LobeChatDatabase } from '@/database/type';
import { fetchPlanById } from '@/server/services/billing/plans-source';

import { writeSubscriptionEvent } from './writeSubscriptionEvent';

/**
 * Flag users whose subscription expires within 4 days and haven't been warned yet.
 * Bulk UPDATE — idempotent (expiryWarningSentAt IS NULL guard).
 */
async function flagExpiringSubscriptions(db: LobeChatDatabase): Promise<void> {
  await db
    .update(userBilling)
    .set({
      expiryWarningSentAt: new Date(),
      botNotifyPending: true,
      botNotifyType: 'subscription_expiring',
    })
    .where(
      and(
        isNull(userBilling.expiryWarningSentAt),
        isNotNull(userBilling.subscriptionExpiresAt),
        gte(userBilling.subscriptionExpiresAt, sql`now()`),
        lte(userBilling.subscriptionExpiresAt, sql`now() + interval '4 days'`),
        isNotNull(userBilling.tgBotChatId),
      ),
    );
}

/**
 * Flag heavy users on paid plans (≥80% monthly credits used) who expire within
 * 3 days with a usage_warning notification. Throttled to once per 23 hours.
 */
async function flagUsageWarnings(db: LobeChatDatabase): Promise<void> {
  // Fetch candidates: paid plan, expiring within 3 days, has bot, not throttled
  const candidates = await db
    .select({
      userId: userBilling.userId,
      tokensUsedMonth: userBilling.tokensUsedMonth,
      tokenBalance: userBilling.tokenBalance,
      planId: userBilling.planId,
    })
    .from(userBilling)
    .where(
      and(
        isNotNull(userBilling.tgBotChatId),
        not(eq(userBilling.planId, 1)), // not Free (planId=1)
        isNotNull(userBilling.subscriptionExpiresAt),
        gte(userBilling.subscriptionExpiresAt, sql`now()`),
        lte(userBilling.subscriptionExpiresAt, sql`now() + interval '3 days'`),
        or(
          isNull(userBilling.upgradeHintSentAt),
          lt(userBilling.upgradeHintSentAt, sql`now() - interval '23 hours'`),
        ),
      ),
    )
    .limit(500);

  for (const row of candidates) {
    const plan = await fetchPlanById(row.planId);
    if (!plan) continue;
    const totalAvailable = plan.tokenLimit + row.tokenBalance;
    if (row.tokensUsedMonth < totalAvailable * 0.8) continue; // under 80%

    await db
      .update(userBilling)
      .set({
        upgradeHintSentAt: new Date(),
        botNotifyPending: true,
        botNotifyType: 'usage_warning',
      })
      .where(eq(userBilling.userId, row.userId));
  }
}

/**
 * Find users whose subscription has expired and we haven't yet logged a
 * 'cancelled' event for their current plan expiration. Write one event per
 * such user.
 *
 * Also runs pre-expiry scan logic (subscription_expiring + usage_warning)
 * BEFORE the actual expiration handling.
 */
export async function expireSubscriptions(db: LobeChatDatabase): Promise<number> {
  // ---- Pre-expiry notification flags (run before expiration logic) ----
  await flagExpiringSubscriptions(db);
  await flagUsageWarnings(db);

  // ---- Expiration handling ----
  const now = new Date();

  // Candidates: have planId != free(1) AND a past subscriptionExpiresAt.
  const expired = await db
    .select({
      userId: userBilling.userId,
      planId: userBilling.planId,
      expiresAt: userBilling.subscriptionExpiresAt,
    })
    .from(userBilling)
    .where(
      and(
        isNotNull(userBilling.subscriptionExpiresAt),
        lt(userBilling.subscriptionExpiresAt, now),
        not(eq(userBilling.planId, 1)), // 1 = Free
      ),
    );

  let written = 0;
  for (const row of expired) {
    // Skip if we already logged a 'cancelled' event after this expiry.
    const existing = await db
      .select({ id: billingSubscriptionEvents.id })
      .from(billingSubscriptionEvents)
      .where(
        and(
          eq(billingSubscriptionEvents.userId, row.userId),
          eq(billingSubscriptionEvents.eventType, 'cancelled'),
          sql`${billingSubscriptionEvents.createdAt} > ${row.expiresAt!}`,
        ),
      )
      .limit(1);
    if (existing.length > 0) continue;

    const plan = await fetchPlanById(row.planId);

    // Phase 2.5 — actually MOVE the user back to Free.
    //
    // Previous bug: this loop only wrote a `cancelled` analytics event but
    // left `user_billing.plan_id` and `subscription_expires_at` unchanged.
    // Result: paid users whose subscription expired kept their paid quota
    // and features forever. Audit found ≥1 user (`48b6e949-…`) on plan_id=2
    // with expires_at=2026-04-01 still being treated as paid 35 days later.
    //
    // Now we update user_billing alongside the event write. We do NOT touch
    // tokenBalance — top-ups paid for separately stay valid.
    await db
      .update(userBilling)
      .set({
        planId: 1,
        subscriptionExpiresAt: null,
        autoRenew: false,
      })
      .where(eq(userBilling.userId, row.userId));

    await writeSubscriptionEvent(db, {
      userId: row.userId,
      fromPlanId: row.planId,
      toPlanId: 1, // Free
      fromPlanPrice: plan?.priceRub ?? 0,
      toPlanPrice: 0,
      currentExpiresAt: row.expiresAt,
    });
    written++;
  }
  return written;
}
