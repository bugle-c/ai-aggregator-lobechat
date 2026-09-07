import { and, count, eq, sql } from 'drizzle-orm';

import { billingPayments, promoCodes, promoRedemptions, userBilling } from '@/database/schemas';
import { type LobeChatDatabase } from '@/database/type';

/**
 * 48h intro offer: a user who claimed the earned-magic bonus gets bonus
 * credits on top of their FIRST successful payment, if that payment lands
 * within 48h of the claim. The amount is the MAGIC48 promo row's
 * `token_amount` (500 since 2026-09-07, was 1000). The credits go to the
 * expiring `bonus_balance` pool and burn after `INTRO_OFFER_BONUS_DAYS` —
 * the same pool and rules as the magic-images bonus (`activeBonusFor`).
 * The grant is a programmatic redemption of the promo code (see
 * docs/superpowers/plans/sql/magic48-promo.sql) — UNIQUE (promo_id, user_id)
 * on promo_redemptions makes it idempotent per user.
 */
export const INTRO_OFFER_PROMO_CODE = 'MAGIC48';
export const INTRO_OFFER_WINDOW_MS = 48 * 60 * 60 * 1000;
/** How long the granted bonus credits live. Owner decision 2026-09-07. */
export const INTRO_OFFER_BONUS_DAYS = 7;
const BONUS_TTL_MS = INTRO_OFFER_BONUS_DAYS * 86_400_000;

export interface IntroOfferState {
  /** Bonus credits the offer grants; present iff eligible. */
  bonusCredits?: number;
  /** Days the bonus credits live after the grant; present iff eligible. */
  bonusDays?: number;
  eligible: boolean;
  /** ISO timestamp of the offer deadline; present iff eligible. */
  expiresAt?: string;
}

export interface BonusRow {
  bonusBalance: number | null;
  bonusBalanceExpiresAt: Date | null;
}

/**
 * The bonus pool after adding `amount` at `now`. The pool has a single
 * expiry (same rule `grantMagicImagesBonus` follows): a live remainder is
 * kept and its life extended to the new expiry; an expired remainder must
 * not be revived by the new grant, so it is replaced.
 */
export const nextBonusState = (
  row: BonusRow | null | undefined,
  amount: number,
  now: Date = new Date(),
): { bonusBalance: number; bonusBalanceExpiresAt: Date } => {
  const live =
    !!row?.bonusBalance &&
    row.bonusBalance > 0 &&
    !!row.bonusBalanceExpiresAt &&
    row.bonusBalanceExpiresAt.getTime() > now.getTime();
  return {
    bonusBalance: (live ? row.bonusBalance! : 0) + amount,
    bonusBalanceExpiresAt: new Date(now.getTime() + BONUS_TTL_MS),
  };
};

const loadActivePromo = async (db: LobeChatDatabase) => {
  const [promo] = await db
    .select()
    .from(promoCodes)
    .where(and(eq(promoCodes.code, INTRO_OFFER_PROMO_CODE), eq(promoCodes.isActive, true)))
    .limit(1);
  return promo;
};

/**
 * Pre-payment eligibility for the UI banner: the magic bonus was claimed
 * within the last 48h, the user has never paid, and the promo row is live.
 */
export async function getIntroOfferState(
  db: LobeChatDatabase,
  userId: string,
): Promise<IntroOfferState> {
  const [billing] = await db
    .select({ magicBonusClaimedAt: userBilling.magicBonusClaimedAt })
    .from(userBilling)
    .where(eq(userBilling.userId, userId))
    .limit(1);

  const claimedAt = billing?.magicBonusClaimedAt;
  if (!claimedAt) return { eligible: false };

  const expiresAtMs = claimedAt.getTime() + INTRO_OFFER_WINDOW_MS;
  if (Date.now() >= expiresAtMs) return { eligible: false };

  const [payments] = await db
    .select({ value: count() })
    .from(billingPayments)
    .where(and(eq(billingPayments.userId, userId), eq(billingPayments.status, 'succeeded')));
  if ((payments?.value ?? 0) > 0) return { eligible: false };

  // The banner must not promise what the grant would skip.
  const promo = await loadActivePromo(db);
  if (!promo?.tokenAmount || promo.usedCount >= promo.maxUses) return { eligible: false };

  return {
    bonusCredits: promo.tokenAmount,
    bonusDays: INTRO_OFFER_BONUS_DAYS,
    eligible: true,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

/**
 * Called from fulfillPayment AFTER the payment row is marked succeeded.
 * Grants the MAGIC48 bonus when this succeeded payment is the user's first
 * and it landed within 48h of the magic-bonus claim. Never throws — the
 * caller relies on this being best-effort.
 */
export async function maybeGrantIntroOffer(db: LobeChatDatabase, userId: string): Promise<void> {
  try {
    const [billing] = await db
      .select({ magicBonusClaimedAt: userBilling.magicBonusClaimedAt })
      .from(userBilling)
      .where(eq(userBilling.userId, userId))
      .limit(1);

    const claimedAt = billing?.magicBonusClaimedAt;
    if (!claimedAt || Date.now() - claimedAt.getTime() > INTRO_OFFER_WINDOW_MS) return;

    // First payment only: the just-fulfilled payment is already succeeded,
    // so exactly 1 succeeded row means there were no prior ones.
    const [payments] = await db
      .select({ value: count() })
      .from(billingPayments)
      .where(and(eq(billingPayments.userId, userId), eq(billingPayments.status, 'succeeded')));
    if ((payments?.value ?? 0) !== 1) return;

    await db.transaction(async (tx) => {
      const promo = await loadActivePromo(tx as unknown as LobeChatDatabase);

      // Promo row not seeded / disabled / exhausted / misconfigured — skip quietly.
      if (!promo || !promo.tokenAmount || promo.usedCount >= promo.maxUses) return;

      // Idempotency anchor: UNIQUE (promo_id, user_id). A concurrent or
      // repeated fulfillment inserts nothing and we bail before granting.
      const inserted = await tx
        .insert(promoRedemptions)
        .values({ promoId: promo.id, userId })
        .onConflictDoNothing()
        .returning({ id: promoRedemptions.id });
      if (inserted.length === 0) return;

      await tx
        .update(promoCodes)
        .set({ usedCount: sql`${promoCodes.usedCount} + 1` })
        .where(eq(promoCodes.id, promo.id));

      // Expiring bonus pool, not the permanent token balance.
      const [row] = await tx
        .select({
          bonusBalance: userBilling.bonusBalance,
          bonusBalanceExpiresAt: userBilling.bonusBalanceExpiresAt,
        })
        .from(userBilling)
        .where(eq(userBilling.userId, userId))
        .for('update')
        .limit(1);
      const next = nextBonusState(row, promo.tokenAmount);

      await tx
        .update(userBilling)
        .set({
          bonusBalance: next.bonusBalance,
          bonusBalanceExpiresAt: next.bonusBalanceExpiresAt,
          updatedAt: new Date(),
        })
        .where(eq(userBilling.userId, userId));

      console.info(
        `[billing] Intro offer granted: user=${userId} +${promo.tokenAmount} bonus credits for ${INTRO_OFFER_BONUS_DAYS}d (${INTRO_OFFER_PROMO_CODE})`,
      );
    });
  } catch (error) {
    // MUST NOT break fulfillment.
    console.error('[billing] intro offer grant error:', error);
  }
}
