import { and, asc, desc, eq, gt, gte, inArray, lt, sql } from 'drizzle-orm';

import type { BillingPaymentItem, NewBillingPayment, UserBillingItem } from '@/database/schemas';
import { billingPayments, creditHolds, refundCreditLots, usageCreditCorrections, usageLogs, userBilling } from '@/database/schemas';
import { type LobeChatDatabase, type Transaction } from '@/database/type';

import { activeBonusFor } from '@/server/modules/billing/active-bonus';
import { fetchActivePlans, fetchPlanById, type PlanView } from './plans-source';

export type { PlanView };

const FREE_PLAN_ID = 1;
/** Paid usage period — same 30 days `fulfillPayment` adds to subscription_expires_at. */
const PAID_PERIOD_DAYS = 30;

/**
 * Usage-period boundaries for the lazy reset, from the app clock:
 *   free (plan_id = 1) — calendar month, 1st 00:00 UTC.
 *   paid               — 30-day cycle from month_start, which updatePlan sets
 *                        to now() on every purchase/renewal. A calendar reset
 *                        for paid plans would hand a Sept-28 payer a second
 *                        full allowance on Oct 1 (review 2026-09-13, MUST #1).
 */
export function usagePeriodBoundaries(now: Date) {
  const currentMonthStart = new Date(now);
  currentMonthStart.setUTCDate(1);
  currentMonthStart.setUTCHours(0, 0, 0, 0);
  const paidPeriodCutoff = new Date(now.getTime() - PAID_PERIOD_DAYS * 86_400_000);
  return { currentMonthStart, paidPeriodCutoff };
}

/** Pure mirror of the conditional UPDATE in getOrResetUserBilling. */
export function usagePeriodNeedsReset(args: { monthStart: Date; now: Date; planId: number }) {
  const { currentMonthStart, paidPeriodCutoff } = usagePeriodBoundaries(args.now);
  return args.planId === FREE_PLAN_ID
    ? args.monthStart < currentMonthStart
    : args.monthStart < paidPeriodCutoff;
}

export class BillingService {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  // ============ Plans ============ //

  getActivePlans = async (): Promise<PlanView[]> => {
    return fetchActivePlans();
  };

  getPlanById = async (planId: number): Promise<PlanView | undefined> => {
    return fetchPlanById(planId);
  };

  // ============ User Billing ============ //

  getUserBilling = async (): Promise<UserBillingItem | undefined> => {
    const rows = await this.db
      .select()
      .from(userBilling)
      .where(eq(userBilling.userId, this.userId))
      .limit(1);

    return rows[0];
  };

  getOrCreateUserBilling = async (): Promise<UserBillingItem> => {
    const existing = await this.getUserBilling();
    if (existing) return existing;

    await this.db
      .insert(userBilling)
      .values({ userId: this.userId })
      .onConflictDoNothing({ target: userBilling.userId });

    // Re-fetch after insert (handles race condition where onConflictDoNothing fired)
    const created = await this.getUserBilling();
    return created!;
  };

  getOrResetUserBilling = async (): Promise<UserBillingItem> => {
    // Ensure row exists (idempotent insert, races safe via onConflict).
    const existing = await this.getOrCreateUserBilling();

    // Fast path: nothing to reset — skip the UPDATE round-trip that used to
    // run on every request. The conditional UPDATE below stays the source
    // of truth for the race case.
    const now = new Date();
    if (!usagePeriodNeedsReset({ monthStart: existing.monthStart, now, planId: existing.planId })) {
      return existing;
    }

    // Lazy usage-period reset (H1 race fix):
    // Two concurrent requests crossing the boundary could both read the old
    // monthStart, both decide "needs reset", and both set tokensUsedMonth=0
    // — wiping a charge that landed in between. Use a *conditional* UPDATE
    // that only fires when the stored monthStart is genuinely older than
    // the current period boundary (see usagePeriodBoundaries), then re-read.
    // Both boundaries come from the app clock (not now() in SQL) so they are
    // consistent with the fast-path check and deterministic under test.
    const { currentMonthStart, paidPeriodCutoff } = usagePeriodBoundaries(now);
    // PostgreSQL resolves CASE's unknown parameters to text before applying
    // the assignment's target type. Give both date branches their actual type.

    await this.db.execute(sql`
      UPDATE user_billing
      SET tokens_used_month = 0,
          month_start = CASE WHEN plan_id = ${FREE_PLAN_ID} THEN ${currentMonthStart}::timestamptz ELSE ${now}::timestamptz END,
          updated_at = now()
      WHERE user_id = ${this.userId}
        AND (
          (plan_id = ${FREE_PLAN_ID} AND month_start < ${currentMonthStart})
          OR (plan_id <> ${FREE_PLAN_ID} AND month_start < ${paidPeriodCutoff})
        )
    `);

    const refreshed = await this.getUserBilling();
    return refreshed!;
  };

  getUserPlanSlug = async (): Promise<string> => {
    const billing = await this.getOrResetUserBilling();
    const plan = await this.getPlanById(billing.planId);
    return plan?.slug || 'free';
  };

  /**
   * Switch the user's plan. `resetMonthlyUsage` opens a fresh usage period
   * in the SAME update — a paid subscription (first purchase, upgrade or
   * renewal) must never inherit the counter accumulated on the previous
   * plan, otherwise a user who exhausted the free quota pays and is still
   * "out of credits" until the lazy calendar-month reset fires.
   */
  updatePlan = async (
    planId: number,
    expiresAt: Date | null,
    opts: { resetMonthlyUsage?: boolean } = {},
  ): Promise<void> => {
    await this.db
      .update(userBilling)
      .set({
        planId,
        subscriptionExpiresAt: expiresAt,
        // Phase 2.3: clear so the "expires soon" reminder fires again next
        // cycle (whether this call is a fresh subscription, a renewal that
        // pushed expiry forward, or a downgrade to free).
        expiryReminderSentAt: null,
        ...(opts.resetMonthlyUsage ? { tokensUsedMonth: 0, monthStart: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(userBilling.userId, this.userId));
  };

  addTokenBalance = async (tokens: number): Promise<void> => {
    await this.db
      .update(userBilling)
      .set({
        tokenBalance: sql`${userBilling.tokenBalance} + ${tokens}`,
        updatedAt: new Date(),
      })
      .where(eq(userBilling.userId, this.userId));
  };


  getCreditBalance = async () => {
    const billing = await this.getOrResetUserBilling();
    const plan = await this.getPlanById(billing.planId);
    const lots = await this.db.select().from(refundCreditLots).where(and(
      eq(refundCreditLots.userId, this.userId), gt(refundCreditLots.expiresAt, new Date()),
      gt(refundCreditLots.remaining, 0),
    ));
    const refundRemaining = lots.reduce((sum, lot) => sum + lot.remaining, 0);
    const ordinaryLimit = (plan?.tokenLimit ?? 0) + billing.tokenBalance + activeBonusFor(billing);
    const ordinaryRemaining = Math.max(0, ordinaryLimit - billing.tokensUsedMonth);
    return { billing, plan, refundRemaining, ordinaryRemaining,
      creditsRemaining: ordinaryRemaining + refundRemaining,
      totalAvailable: ordinaryLimit + refundRemaining };
  };

  private lockBilling = async (tx: Transaction) => {
    const [billing] = await tx.select().from(userBilling)
      .where(eq(userBilling.userId, this.userId)).for('update');
    if (!billing) throw new Error('Missing billing account');
    const now = new Date();
    if (!usagePeriodNeedsReset({ monthStart: billing.monthStart, now, planId: billing.planId })) return billing;
    const monthStart = billing.planId === FREE_PLAN_ID ? usagePeriodBoundaries(now).currentMonthStart : now;
    const [reset] = await tx.update(userBilling).set({ tokensUsedMonth: 0, monthStart, updatedAt: now })
      .where(eq(userBilling.userId, this.userId)).returning();
    return reset!;
  };

  private allocateCredits = async (amount: number, tx: Transaction, clamp = false) => {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Invalid credit amount');
    const billing = await this.lockBilling(tx);
    const lots = await tx.select().from(refundCreditLots).where(and(
      eq(refundCreditLots.userId, this.userId), gt(refundCreditLots.expiresAt, new Date()),
      gt(refundCreditLots.remaining, 0),
    )).orderBy(asc(refundCreditLots.expiresAt), asc(refundCreditLots.id)).for('update');
    const plan = await this.getPlanById(billing.planId);
    const ordinaryRemaining = Math.max(0, (plan?.tokenLimit ?? 0) + billing.tokenBalance + activeBonusFor(billing) - billing.tokensUsedMonth);
    const available = ordinaryRemaining + lots.reduce((sum, lot) => sum + lot.remaining, 0);
    if (!clamp && amount > available) throw new Error('Insufficient credits');
    const committed = Math.min(amount, available);
    let pending = committed;
    const refundAllocations: Array<{ lotId: string; amount: number }> = [];
    for (const lot of lots) {
      const used = Math.min(pending, lot.remaining);
      if (!used) break;
      await tx.update(refundCreditLots).set({ remaining: lot.remaining - used }).where(eq(refundCreditLots.id, lot.id));
      refundAllocations.push({ lotId: lot.id, amount: used });
      pending -= used;
    }
    if (pending) await tx.update(userBilling).set({ tokensUsedMonth: billing.tokensUsedMonth + pending, updatedAt: new Date() })
      .where(eq(userBilling.userId, this.userId));
    return { committed, ordinaryAmount: pending, usagePeriod: billing.monthStart, refundAllocations };
  };

  spendCredits = async (amount: number, tx: Transaction, opts: { clamp?: boolean } = {}) => {
    return this.allocateCredits(amount, tx, opts.clamp);
  };

  reserveCredits = async (amount: number, reason: string, asyncTaskId?: string, tx?: Transaction) => {
    const reserve = async (client: Transaction) => {
      const allocation = await this.allocateCredits(amount, client);
      const [hold] = await client.insert(creditHolds).values({ userId: this.userId, amount, reason,
        asyncTaskId, ordinaryAmount: allocation.ordinaryAmount, usagePeriod: allocation.usagePeriod,
        refundAllocations: allocation.refundAllocations }).returning();
      return hold!;
    };
    return tx ? reserve(tx) : this.db.transaction(reserve);
  };

  splitCreditHold = async (holdId: string, amounts: number[], tx: Transaction) => {
    await this.lockBilling(tx);
    const [hold] = await tx.select().from(creditHolds).where(and(eq(creditHolds.id, holdId),
      eq(creditHolds.userId, this.userId))).for('update');
    if (!hold || hold.releasedAt || !amounts.length || amounts.some((amount) => !Number.isSafeInteger(amount) || amount < 0) ||
      amounts.reduce((sum, amount) => sum + amount, 0) !== hold.amount) throw new Error('Invalid active hold split');
    let ordinaryLeft = hold.ordinaryAmount ?? hold.amount;
    const allocations = hold.refundAllocations.map((allocation) => ({ ...allocation }));
    const children = [];
    for (const amount of amounts) {
      let pending = amount;
      const refundAllocations: Array<{ lotId: string; amount: number }> = [];
      for (const allocation of allocations) {
        const used = Math.min(pending, allocation.amount);
        if (used) refundAllocations.push({ lotId: allocation.lotId, amount: used });
        allocation.amount -= used;
        pending -= used;
      }
      if (pending > ordinaryLeft) throw new Error('Inconsistent hold funding');
      ordinaryLeft -= pending;
      const [child] = await tx.insert(creditHolds).values({ userId: this.userId, amount, reason: hold.reason,
        ordinaryAmount: pending, usagePeriod: hold.usagePeriod, refundAllocations, createdAt: hold.createdAt }).returning();
      children.push(child!);
    }
    if (ordinaryLeft || allocations.some((allocation) => allocation.amount)) throw new Error('Inconsistent hold funding');
    // Transfer ownership, not money: do not restore sources or change captured expiries.
    await tx.update(creditHolds).set({ releasedAt: new Date() }).where(eq(creditHolds.id, hold.id));
    return children;
  };

  settleCreditHold = async (holdId: string, actualCredits: number, tx: Transaction) => {
    if (!Number.isSafeInteger(actualCredits) || actualCredits < 0) throw new Error('Invalid credit amount');
    const billing = await this.lockBilling(tx);
    const [hold] = await tx.select().from(creditHolds).where(and(eq(creditHolds.id, holdId),
      eq(creditHolds.userId, this.userId))).for('update');
    if (!hold || hold.releasedAt) return { settled: false, committed: 0 };
    // Keep the original source allocation for the settled portion; return excess in reverse order.
    let excess = Math.max(0, hold.amount - actualCredits);
    const ordinary = hold.ordinaryAmount ?? hold.amount;
    const ordinaryReturn = Math.min(excess, ordinary);
    const samePeriod = hold.usagePeriod
      ? hold.usagePeriod.getTime() === billing.monthStart.getTime()
      : hold.createdAt >= billing.monthStart;
    if (ordinaryReturn && samePeriod) await tx.update(userBilling).set({
      tokensUsedMonth: sql`GREATEST(0, ${userBilling.tokensUsedMonth} - ${ordinaryReturn})`, updatedAt: new Date(),
    }).where(eq(userBilling.userId, this.userId));
    excess -= ordinaryReturn;
    for (const allocation of [...hold.refundAllocations].reverse()) {
      const returned = Math.min(excess, allocation.amount);
      if (!returned) break;
      // Expiry is immutable: returning an expired lot never makes it spendable.
      await tx.update(refundCreditLots).set({ remaining: sql`${refundCreditLots.remaining} + ${returned}` })
        .where(and(eq(refundCreditLots.id, allocation.lotId), eq(refundCreditLots.userId, this.userId)));
      excess -= returned;
    }
    if (actualCredits > hold.amount) await this.allocateCredits(actualCredits - hold.amount, tx);
    await tx.update(creditHolds).set({ releasedAt: new Date() }).where(eq(creditHolds.id, hold.id));
    return { settled: true, committed: actualCredits };
  };

  grantRefundCorrections = async (input: { campaign: string; fixCutoff: Date; corrections: Array<{
    usageId: string; correctedCredits: number; evidence: { source: string; reference: string; pricing: string };
  }> }) => {
    const start = new Date('2026-09-30T21:00:00Z');
    if (!input.campaign.trim() || !Number.isFinite(input.fixCutoff.getTime()) || input.fixCutoff <= start || input.fixCutoff > new Date()) {
      throw new Error('Invalid reviewed reconciliation campaign');
    }
    await this.getOrCreateUserBilling();
    return this.db.transaction(async (tx) => {
      const billing = await this.lockBilling(tx);
      const campaignLots = await tx.select({ fixCutoff: refundCreditLots.fixCutoff }).from(refundCreditLots)
        .where(and(eq(refundCreditLots.userId, this.userId), eq(refundCreditLots.campaign, input.campaign)));
      if (campaignLots.some((lot) => lot.fixCutoff.getTime() !== input.fixCutoff.getTime())) {
        throw new Error('Campaign cutoff is immutable');
      }
      const [payment] = await tx.select({ id: billingPayments.id }).from(billingPayments).where(and(
        eq(billingPayments.userId, this.userId), eq(billingPayments.status, 'succeeded'), gt(billingPayments.amountRub, 0),
        inArray(billingPayments.type, ['subscription', 'topup']), gte(billingPayments.createdAt, start),
        lt(billingPayments.createdAt, input.fixCutoff),
      )).limit(1);
      if (!payment) throw new Error('Not eligible for reconciliation');
      const now = new Date();
      const expiresAt = billing.planId !== FREE_PLAN_ID && billing.subscriptionExpiresAt && billing.subscriptionExpiresAt > now
        ? billing.subscriptionExpiresAt : new Date(now.getTime() + 30 * 86_400_000);
      // A lot is created only after all evidence validates; transaction rollback removes empty/failed grants.
      const proposed: Array<{ usageId: string; originalCredits: number; correctedCredits: number;
        evidence: { source: string; reference: string; pricing: string } }> = [];
      for (const correction of input.corrections) {
        if (!Number.isSafeInteger(correction.correctedCredits) || correction.correctedCredits < 0 ||
          !correction.evidence.source.trim() || !correction.evidence.reference.trim() || !correction.evidence.pricing.trim()) throw new Error('Missing correction evidence');
        const [usage] = await tx.select().from(usageLogs).where(and(eq(usageLogs.id, correction.usageId),
          eq(usageLogs.userId, this.userId), gte(usageLogs.createdAt, start), lt(usageLogs.createdAt, input.fixCutoff)));
        if (!usage || correction.correctedCredits >= usage.creditsCharged) throw new Error('Correction must be a positive evidenced overcharge');
        if (usage.providerCostStatus !== 'verified' || usage.actualProviderCostUsd === null ||
          usage.providerRequestId !== correction.evidence.reference || usage.providerCostSource !== correction.evidence.source) {
          throw new Error('Correction evidence does not match verified original usage');
        }
        const [existing] = await tx.select({ id: usageCreditCorrections.id }).from(usageCreditCorrections).where(and(
          eq(usageCreditCorrections.campaign, input.campaign), eq(usageCreditCorrections.usageId, usage.id)));
        if (!existing && !proposed.some((row) => row.usageId === usage.id)) proposed.push({ ...correction, originalCredits: usage.creditsCharged });
      }
      const granted = proposed.reduce((sum, row) => sum + row.originalCredits - row.correctedCredits, 0);
      if (!Number.isSafeInteger(granted) || granted > 2_147_483_647) throw new Error('Refund credit amount exceeds ledger range');
      if (!granted) return { granted: 0, lotId: null };
      const [lot] = await tx.insert(refundCreditLots).values({ userId: this.userId, campaign: input.campaign,
        fixCutoff: input.fixCutoff, granted, remaining: granted, expiresAt }).returning();
      await tx.insert(usageCreditCorrections).values(proposed.map((row) => ({ ...row, campaign: input.campaign, lotId: lot!.id })));
      return { granted, lotId: lot!.id };
    });
  };

  getUserHistory = async (limit = 20) => {
    const [payments, refunds] = await Promise.all([
      this.getUserPayments(limit),
      this.db.select().from(refundCreditLots).where(eq(refundCreditLots.userId, this.userId))
        .orderBy(desc(refundCreditLots.createdAt)).limit(limit),
    ]);
    return [...payments.map((payment) => ({ ...payment, kind: 'payment' as const })),
      ...refunds.map((refund) => ({ ...refund, kind: 'refund' as const, credits: refund.granted,
        status: refund.expiresAt > new Date() ? 'credited' as const : 'expired' as const,
        description: 'Возврат кредитов из-за технической ошибки' }))]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
  };
  // ============ Payments ============ //

  createPayment = async (data: Omit<NewBillingPayment, 'userId'>): Promise<BillingPaymentItem> => {
    const rows = await this.db
      .insert(billingPayments)
      .values({ ...data, userId: this.userId })
      .returning();

    return rows[0]!;
  };

  getUserPayments = async (limit: number = 20): Promise<BillingPaymentItem[]> => {
    return this.db
      .select()
      .from(billingPayments)
      .where(eq(billingPayments.userId, this.userId))
      .orderBy(desc(billingPayments.createdAt))
      .limit(limit);
  };

  // ============ Static methods (no userId needed) ============ //

  static getPaymentByYookassaId = async (
    db: LobeChatDatabase,
    yookassaId: string,
  ): Promise<BillingPaymentItem | undefined> => {
    const rows = await db
      .select()
      .from(billingPayments)
      .where(eq(billingPayments.yookassaPaymentId, yookassaId))
      .limit(1);

    return rows[0];
  };

  static updatePaymentStatus = async (
    db: LobeChatDatabase,
    paymentId: string,
    status: string,
  ): Promise<void> => {
    await db
      .update(billingPayments)
      .set({ status, updatedAt: new Date() })
      .where(eq(billingPayments.id, paymentId));
  };

  static updatePaymentYookassaId = async (
    db: LobeChatDatabase,
    paymentId: string,
    yookassaPaymentId: string,
  ): Promise<void> => {
    await db
      .update(billingPayments)
      .set({ yookassaPaymentId, updatedAt: new Date() })
      .where(eq(billingPayments.id, paymentId));
  };
}
