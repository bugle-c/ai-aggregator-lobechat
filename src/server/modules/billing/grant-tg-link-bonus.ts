import { eq, sql } from 'drizzle-orm';

import { userBilling } from '@/database/schemas/billing';
import { type LobeChatDatabase } from '@/database/type';

export interface GrantTgLinkBonusResult {
  alreadyClaimed: boolean;
  /** ISO timestamp; present iff granted > 0. */
  expiresAt?: string;
  /** 0 if already claimed, 100 on first successful grant. */
  granted: number;
}

const BONUS_AMOUNT = 100;
const EXPIRY_MS = 30 * 86_400_000;

/**
 * Idempotent one-shot grant. Safe under concurrent calls — uses row
 * lock + `setWhere` clause to guarantee at most one grant per user_id.
 *
 * Best-effort by contract: callers should treat failure as non-fatal
 * (auth shouldn't break if this throws). The DB transaction either
 * commits both bonus + stamp together or commits nothing.
 */
export async function grantTgLinkBonus(
  db: LobeChatDatabase,
  userId: string,
): Promise<GrantTgLinkBonusResult> {
  return db.transaction(async (tx) => {
    // 1) Acquire row lock if the row exists
    const existing = await tx
      .select({ tgBonusClaimedAt: userBilling.tgBonusClaimedAt })
      .from(userBilling)
      .where(eq(userBilling.userId, userId))
      .for('update')
      .limit(1);

    if (existing[0]?.tgBonusClaimedAt) {
      return { granted: 0, alreadyClaimed: true };
    }

    // 2) UPSERT — covers both insert and "row exists, no stamp" update
    const expiresAt = new Date(Date.now() + EXPIRY_MS);
    await tx
      .insert(userBilling)
      .values({
        userId,
        planId: 1,
        bonusBalance: BONUS_AMOUNT,
        bonusBalanceExpiresAt: expiresAt,
        tgBonusClaimedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userBilling.userId,
        set: {
          bonusBalance: sql`${userBilling.bonusBalance} + ${BONUS_AMOUNT}`,
          bonusBalanceExpiresAt: expiresAt,
          tgBonusClaimedAt: sql`NOW()`,
          updatedAt: new Date(),
        },
        // Double-lock: only update if stamp is still null. With the
        // row lock above this is belt-and-suspenders, but it prevents
        // the rare scenario where the SELECT-FOR-UPDATE somehow saw
        // null but a concurrent transaction committed first.
        setWhere: sql`${userBilling.tgBonusClaimedAt} IS NULL`,
      });

    return {
      granted: BONUS_AMOUNT,
      expiresAt: expiresAt.toISOString(),
      alreadyClaimed: false,
    };
  });
}
