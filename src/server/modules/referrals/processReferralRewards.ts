/**
 * Award referral rewards when a referee links Telegram. Replaces the
 * earlier first-payment trigger — TG link is a stronger anti-fraud
 * signal (unique phone per Telegram account) and unblocks rewards
 * before the referee has to pay anything.
 *
 * Flow:
 *   1. Find `referrals` rows where `referred_user_id = userId AND status='pending'`.
 *   2. For each:
 *      - L1 row: credit BOTH the referrer (+100) and the referee (+100).
 *      - L2 row: credit only the L2 referrer (+30). No referee top-up at L2.
 *   3. Mark the row 'rewarded' with `credits_awarded` set and `rewarded_at` stamped.
 *   4. All credits go to `userBilling.bonus_balance` with 30-day expiry
 *      (`bonus_balance_expires_at = MAX(existing, NOW() + 30d)`).
 *
 * Each award runs in its own transaction so a failure on one level
 * doesn't roll back the other. Conditional UPDATE on status='pending'
 * guarantees idempotence under concurrent calls.
 */
import { and, eq, sql } from 'drizzle-orm';

import { referrals } from '@/database/schemas';
import { type LobeChatDatabase } from '@/database/type';

/** Credits to L1 referrer (the friend who shared the link). */
export const L1_REFERRER_CREDITS = 100;
/** Credits to the referee themselves (bonus for completing the loop). */
export const L1_REFEREE_CREDITS = 100;
/** Credits to L2 referrer (grand-parent — friend-of-friend). */
export const L2_REFERRER_CREDITS = 30;

const EXPIRY_MS = 30 * 86_400_000;

async function addBonusBalance(
  tx: Parameters<Parameters<LobeChatDatabase['transaction']>[0]>[0],
  userId: string,
  credits: number,
) {
  const expiresAt = new Date(Date.now() + EXPIRY_MS);
  await tx.execute(sql`
    INSERT INTO user_billing (user_id, plan_id, bonus_balance, bonus_balance_expires_at)
    VALUES (${userId}, 1, ${credits}, ${expiresAt.toISOString()})
    ON CONFLICT (user_id) DO UPDATE
    SET bonus_balance = user_billing.bonus_balance + ${credits},
        bonus_balance_expires_at = GREATEST(
          COALESCE(user_billing.bonus_balance_expires_at, ${expiresAt.toISOString()}::timestamptz),
          ${expiresAt.toISOString()}::timestamptz
        ),
        updated_at = NOW()
  `);
}

/**
 * Run referral payouts for the given referee. Idempotent — pending-row
 * status filter prevents double-award. Best-effort: caller wraps in
 * try/catch so a hiccup never blocks the surrounding flow.
 */
export async function processReferralRewards(
  db: LobeChatDatabase,
  refereeUserId: string,
): Promise<{ awardedCount: number; totalCredits: number }> {
  const pendingRefs = await db
    .select()
    .from(referrals)
    .where(and(eq(referrals.referredUserId, refereeUserId), eq(referrals.status, 'pending')));

  if (pendingRefs.length === 0) return { awardedCount: 0, totalCredits: 0 };

  let awardedCount = 0;
  let totalCredits = 0;

  for (const ref of pendingRefs) {
    try {
      await db.transaction(async (tx) => {
        // Flip status FIRST so a parallel call races us harmlessly — only
        // the row whose UPDATE actually flipped proceeds to grant.
        const flipped = await tx
          .update(referrals)
          .set({
            status: 'rewarded',
            creditsAwarded: ref.level === 1 ? L1_REFERRER_CREDITS : L2_REFERRER_CREDITS,
            rewardedAt: new Date(),
          })
          .where(and(eq(referrals.id, ref.id), eq(referrals.status, 'pending')))
          .returning({ id: referrals.id });

        if (flipped.length === 0) return; // race lost

        if (ref.level === 1) {
          await addBonusBalance(tx, ref.referrerUserId, L1_REFERRER_CREDITS);
          await addBonusBalance(tx, refereeUserId, L1_REFEREE_CREDITS);
          totalCredits += L1_REFERRER_CREDITS + L1_REFEREE_CREDITS;
        } else {
          await addBonusBalance(tx, ref.referrerUserId, L2_REFERRER_CREDITS);
          totalCredits += L2_REFERRER_CREDITS;
        }
        awardedCount++;
      });
      console.info(
        `[referrals] rewarded L${ref.level}: referrer=${ref.referrerUserId} referred=${refereeUserId}`,
      );
    } catch (error) {
      console.error(`[referrals] reward failed ref=${ref.id} level=${ref.level}:`, error);
    }
  }

  return { awardedCount, totalCredits };
}
