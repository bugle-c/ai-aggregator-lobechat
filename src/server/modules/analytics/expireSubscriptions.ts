import { and, eq, isNotNull, lt, not, sql } from 'drizzle-orm';

import { userBilling } from '@/database/schemas/billing';
import { billingSubscriptionEvents } from '@/database/schemas/analytics';
import { type LobeChatDatabase } from '@/database/type';
import { fetchPlanById } from '@/server/services/billing/plans-source';

import { writeSubscriptionEvent } from './writeSubscriptionEvent';

/**
 * Find users whose subscription has expired and we haven't yet logged a
 * 'cancelled' event for their current plan expiration. Write one event per
 * such user.
 */
export async function expireSubscriptions(db: LobeChatDatabase): Promise<number> {
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
