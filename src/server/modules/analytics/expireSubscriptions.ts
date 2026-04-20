import { and, eq, isNotNull, lt, not, sql } from 'drizzle-orm';

import { type LobeChatDatabase } from '@/database/type';
import { billingSubscriptionEvents } from '@/database/schemas/analytics';
import { billingPlans, userBilling } from '@/database/schemas/billing';

import { writeSubscriptionEvent } from './writeSubscriptionEvent';

/**
 * Find users whose subscription has expired and we haven't yet logged a
 * 'cancelled' event for their current plan expiration. Write one event per
 * such user.
 */
export async function expireSubscriptions(db: LobeChatDatabase): Promise<number> {
  const now = new Date();

  // Candidates: have planId != free(1) OR have a set subscriptionExpiresAt in the past.
  const expired = await db
    .select({
      userId: userBilling.userId,
      planId: userBilling.planId,
      expiresAt: userBilling.subscriptionExpiresAt,
      priceRub: billingPlans.priceRub,
    })
    .from(userBilling)
    .leftJoin(billingPlans, eq(billingPlans.id, userBilling.planId))
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

    await writeSubscriptionEvent(db, {
      userId: row.userId,
      fromPlanId: row.planId,
      toPlanId: 1, // Free
      fromPlanPrice: row.priceRub ?? 0,
      toPlanPrice: 0,
      currentExpiresAt: row.expiresAt,
    });
    written++;
  }
  return written;
}
