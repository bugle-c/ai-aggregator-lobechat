/**
 * Award referral rewards on a referred user's FIRST successful payment.
 *
 * Trigger logic:
 *   - Counts `billing_payments WHERE user_id=X AND status='succeeded'`.
 *   - If exactly 1 (the one being processed right now), this is the user's
 *     first paid event → flip pending L1 + L2 referrals to 'rewarded' and
 *     credit referrers' balances.
 *   - If > 1, no-op. Subsequent payments don't re-trigger rewards.
 *
 * Each reward write is wrapped in a transaction so the credit add and the
 * referrals row update commit atomically. Multiple referrers (L1 + L2) get
 * their own transactions so a failure in one doesn't roll back the other —
 * but each individual referrer's credit + status is atomic.
 *
 * Idempotent against the SAME `referrals` row: the WHERE clause filters on
 * status='pending' so re-runs don't double-credit.
 */
import { and, eq, sql } from 'drizzle-orm';

import { referrals } from '@/database/schemas';
import { type LobeChatDatabase } from '@/database/type';

/** Credit amount awarded to the L1 (direct) referrer on first paid event. */
export const L1_REWARD_CREDITS = 50;
/** Credit amount awarded to the L2 (grand-parent) referrer on first paid event. */
export const L2_REWARD_CREDITS = 25;

function rewardForLevel(level: number): number {
  return level === 1 ? L1_REWARD_CREDITS : L2_REWARD_CREDITS;
}

/**
 * If `paidUserId` has just made their FIRST successful payment, award
 * referral rewards to L1 and L2 referrers (where pending rows exist).
 *
 * Caller invariants:
 *   - The triggering payment has ALREADY been flipped to status='succeeded'
 *     in `billing_payments` BEFORE this function runs (so the count includes
 *     it).
 *   - This function is called from inside `fulfillPayment` after status flip.
 */
export async function rewardReferralsOnFirstPayment(
  db: LobeChatDatabase,
  paidUserId: string,
): Promise<void> {
  // Count succeeded payments for this user. If !== 1, it's not their first.
  const countRows: any = await db.execute(sql`
    SELECT COUNT(*)::int AS cnt
    FROM billing_payments
    WHERE user_id = ${paidUserId}
      AND status = 'succeeded'
  `);
  const rows = (countRows?.rows ?? countRows) as Array<{ cnt: number }>;
  const succeededCount = rows?.[0]?.cnt ?? 0;
  if (succeededCount !== 1) {
    return;
  }

  const pendingRefs = await db
    .select()
    .from(referrals)
    .where(and(eq(referrals.referredUserId, paidUserId), eq(referrals.status, 'pending')));

  if (pendingRefs.length === 0) return;

  for (const ref of pendingRefs) {
    const reward = rewardForLevel(ref.level);
    try {
      await db.transaction(async (tx) => {
        // Credit the referrer. Use INSERT-or-update to survive missing row
        // (edge case: very old user without user_billing seeded).
        await tx.execute(sql`
          INSERT INTO user_billing (user_id, token_balance)
          VALUES (${ref.referrerUserId}, ${reward})
          ON CONFLICT (user_id) DO UPDATE
          SET token_balance = user_billing.token_balance + ${reward},
              updated_at = now()
        `);

        // Conditional UPDATE on status='pending' guarantees idempotence —
        // if a parallel call races us, only the first commits.
        await tx
          .update(referrals)
          .set({
            status: 'rewarded',
            creditsAwarded: reward,
            rewardedAt: new Date(),
          })
          .where(and(eq(referrals.id, ref.id), eq(referrals.status, 'pending')));
      });
      console.info(
        `[referrals] rewarded L${ref.level}: referrer=${ref.referrerUserId} referred=${paidUserId} +${reward}cr`,
      );
    } catch (error) {
      // Per-row failure — log and continue with the next. The other level
      // shouldn't be punished by a transient failure on this one.
      console.error(`[referrals] reward failed for ref=${ref.id} level=${ref.level}:`, error);
    }
  }
}
