import { and, count, eq, sql } from 'drizzle-orm';

import { billingPayments, promoCodes, promoRedemptions, userBilling } from '@/database/schemas';
import { type LobeChatDatabase } from '@/database/type';

/**
 * 48h intro offer: a user who claimed the earned-magic bonus gets +1000
 * credits on top of their FIRST successful payment, if that payment lands
 * within 48h of the claim. The grant is a programmatic redemption of the
 * MAGIC48 promo code (see docs/superpowers/plans/sql/magic48-promo.sql) —
 * the UNIQUE (promo_id, user_id) constraint on promo_redemptions makes the
 * grant idempotent per user.
 */
export const INTRO_OFFER_PROMO_CODE = 'MAGIC48';
export const INTRO_OFFER_WINDOW_MS = 48 * 60 * 60 * 1000;

export interface IntroOfferState {
  eligible: boolean;
  /** ISO timestamp of the offer deadline; present iff eligible. */
  expiresAt?: string;
}

/**
 * Pre-payment eligibility for the UI banner: the magic bonus was claimed
 * within the last 48h and the user has never paid.
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

  return { eligible: true, expiresAt: new Date(expiresAtMs).toISOString() };
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
      const [promo] = await tx
        .select()
        .from(promoCodes)
        .where(and(eq(promoCodes.code, INTRO_OFFER_PROMO_CODE), eq(promoCodes.isActive, true)))
        .limit(1);

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

      await tx
        .update(userBilling)
        .set({
          tokenBalance: sql`${userBilling.tokenBalance} + ${promo.tokenAmount}`,
          updatedAt: new Date(),
        })
        .where(eq(userBilling.userId, userId));

      console.info(
        `[billing] Intro offer granted: user=${userId} +${promo.tokenAmount} credits (${INTRO_OFFER_PROMO_CODE})`,
      );
    });
  } catch (error) {
    // MUST NOT break fulfillment.
    console.error('[billing] intro offer grant error:', error);
  }
}
