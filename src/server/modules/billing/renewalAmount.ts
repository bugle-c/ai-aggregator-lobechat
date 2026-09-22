/**
 * Price lock for auto-renewals.
 *
 * `renew-due-subscriptions` used to charge `ai_aggregator.plans.price_rub`
 * as read at charge time, so an admin editing a tariff silently re-priced
 * every existing subscriber on their next cycle — which the public offer
 * (§5.4, "изменение стоимости не распространяется на уже оплаченные
 * периоды") forbids. Charge what the subscriber actually last paid instead.
 *
 * Shared with the pre-charge notice so the email quotes the amount that will
 * really be taken, not a list price the user never agreed to.
 */
import { and, desc, eq } from 'drizzle-orm';

import { billingPayments } from '@/database/schemas';
import { type LobeChatDatabase } from '@/database/type';

export interface LastSubscriptionPayment {
  amountRub: number;
  planId: number | null;
}

/** The user's most recent succeeded subscription payment, if any. */
export async function fetchLastSubscriptionPayment(
  db: LobeChatDatabase,
  userId: string,
): Promise<LastSubscriptionPayment | null> {
  const [row] = await db
    .select({ amountRub: billingPayments.amountRub, planId: billingPayments.planId })
    .from(billingPayments)
    .where(
      and(
        eq(billingPayments.userId, userId),
        eq(billingPayments.type, 'subscription'),
        eq(billingPayments.status, 'succeeded'),
      ),
    )
    .orderBy(desc(billingPayments.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * Which tier to re-charge.
 *
 * `expireSubscriptions` downgrades a lapsed row to the free plan while keeping
 * auto_renew + subscription_expires_at so dunning can continue, which means
 * `user_billing.plan_id` no longer says what to restore. For those rows the
 * answer is the tier of the last succeeded subscription payment. Returns null
 * when there is nothing to renew.
 */
export function resolveRenewalPlanId(
  currentPlanId: number,
  lastPaid: LastSubscriptionPayment | null,
  freePlanId = 1,
): number | null {
  const resolved = currentPlanId !== freePlanId ? currentPlanId : (lastPaid?.planId ?? null);
  return resolved === null || resolved === freePlanId ? null : resolved;
}

/**
 * Amount to charge for `planId`. Honours the locked price only when the last
 * payment was for the SAME plan — after an upgrade the old amount is simply
 * the wrong tier. Falls back to the current list price.
 */
export function resolveRenewalAmount(
  lastPaid: LastSubscriptionPayment | null,
  planId: number,
  currentPriceRub: number,
): number {
  return lastPaid && lastPaid.planId === planId ? lastPaid.amountRub : currentPriceRub;
}
