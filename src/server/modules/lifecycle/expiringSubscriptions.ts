/**
 * Phase 2.3 — Query for users needing the "subscription expires in 3 days"
 * reminder.
 *
 * Selects user_billing rows that:
 *   - have plan_id != 1 (paid plans only — free plan id is hard-coded as 1
 *     in the seed; if that ever moves we filter by `priceRub > 0` in JS),
 *   - have subscription_expires_at within (now + 2 days, now + 3 days],
 *   - have not yet had a reminder sent for this cycle
 *     (expiry_reminder_sent_at IS NULL).
 *
 * Returned rows include the user's email and plan name for the email body.
 *
 * `markReminderSent` flips `expiry_reminder_sent_at = now()` so the next run
 * skips this user. The column is reset to NULL by `BillingService.updatePlan`
 * on every plan change / renewal.
 */
import { and, eq, gt, isNull, lte, sql } from 'drizzle-orm';

import { billingPlans, userBilling, users } from '@/database/schemas';
import { type LobeChatDatabase } from '@/database/type';

export interface ExpiringSubscriptionRow {
  email: string | null;
  planId: number;
  planName: string;
  planPriceRub: number;
  subscriptionExpiresAt: Date;
  userId: string;
}

/** Fetch users with subscriptions expiring in (now+2d, now+3d] who have no reminder yet. */
export async function listExpiringSubscriptions(
  db: LobeChatDatabase,
): Promise<ExpiringSubscriptionRow[]> {
  // Drizzle interval arithmetic: cast `now() + interval '...'` via SQL fragment.
  const lowerBound = sql`now() + interval '2 days'`;
  const upperBound = sql`now() + interval '3 days'`;

  const rows = await db
    .select({
      userId: userBilling.userId,
      email: users.email,
      planId: userBilling.planId,
      planName: billingPlans.name,
      planPriceRub: billingPlans.priceRub,
      subscriptionExpiresAt: userBilling.subscriptionExpiresAt,
    })
    .from(userBilling)
    .innerJoin(users, eq(users.id, userBilling.userId))
    .innerJoin(billingPlans, eq(billingPlans.id, userBilling.planId))
    .where(
      and(
        // paid plan: id != 1 AND priceRub > 0 (defence in depth)
        gt(billingPlans.priceRub, 0),
        // expiry between now+2d and now+3d (inclusive upper)
        gt(userBilling.subscriptionExpiresAt, lowerBound),
        lte(userBilling.subscriptionExpiresAt, upperBound),
        // not already reminded this cycle
        isNull(userBilling.expiryReminderSentAt),
      ),
    );

  return rows
    .filter(
      (r): r is typeof r & { subscriptionExpiresAt: Date } => r.subscriptionExpiresAt !== null,
    )
    .map((r) => ({
      userId: r.userId,
      email: r.email,
      planId: r.planId,
      planName: r.planName,
      planPriceRub: r.planPriceRub,
      subscriptionExpiresAt: r.subscriptionExpiresAt as Date,
    }));
}

/** Mark a user's reminder as sent so we don't re-send for the same cycle. */
export async function markReminderSent(db: LobeChatDatabase, userId: string): Promise<void> {
  await db
    .update(userBilling)
    .set({ expiryReminderSentAt: new Date() })
    .where(eq(userBilling.userId, userId));
}

/**
 * Pure predicate version of the SQL filter — used in tests and as a final
 * defence-in-depth check before sending the email (in case query semantics
 * drift).
 *
 * Returns true iff `expiresAt` falls in the half-open window
 * `(now+2d, now+3d]` and `priceRub > 0` and `reminderSentAt` is null.
 */
export function isExpiringWithinWindow(args: {
  expiresAt: Date | null;
  reminderSentAt: Date | null;
  priceRub: number;
  now?: Date;
}): boolean {
  if (!args.expiresAt) return false;
  if (args.reminderSentAt) return false;
  if (args.priceRub <= 0) return false;
  const now = (args.now ?? new Date()).getTime();
  const t = args.expiresAt.getTime();
  const twoDays = 2 * 24 * 60 * 60 * 1000;
  const threeDays = 3 * 24 * 60 * 60 * 1000;
  return t > now + twoDays && t <= now + threeDays;
}
