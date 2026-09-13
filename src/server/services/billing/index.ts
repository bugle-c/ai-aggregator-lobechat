import { desc, eq, sql } from 'drizzle-orm';

import type { BillingPaymentItem, NewBillingPayment, UserBillingItem } from '@/database/schemas';
import { billingPayments, userBilling } from '@/database/schemas';
import { type LobeChatDatabase, type Transaction } from '@/database/type';

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

    await this.db.execute(sql`
      UPDATE user_billing
      SET tokens_used_month = 0,
          month_start = CASE WHEN plan_id = ${FREE_PLAN_ID} THEN ${currentMonthStart} ELSE ${now} END,
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

  /**
   * Increment the user's monthly token counter. Pass a `tx` when this must
   * commit/rollback atomically with a sibling write (e.g. usage_logs insert)
   * — see recordTokenUsage and chargeAfterGenerate.
   *
   * `opts.limit` (Pkg2, C1 race fix): when set, the UPDATE is conditional —
   * it only commits if `tokens_used_month + delta <= limit`. The DB's row
   * lock + WHERE-evaluation guarantees concurrent callers can't both pass
   * the limit check on stale reads. If 0 rows match (would overshoot, OR
   * the user_billing row is missing), we throw and the caller's tx rolls back.
   *
   * `delta` may be negative (refund / reconcile under-charge → over-charge swap).
   * The conditional clause skips negative-delta limit checks (a refund can
   * never overshoot a positive cap).
   */
  incrementTokensUsed = async (
    tokens: number,
    tx?: Transaction,
    opts?: { limit?: number },
  ): Promise<{ committed: number }> => {
    const client = tx ?? this.db;
    if (opts?.limit != null && tokens > 0) {
      const limit = opts.limit;
      const result: any = await client.execute(sql`
        UPDATE user_billing
        SET tokens_used_month = tokens_used_month + ${tokens},
            updated_at = now()
        WHERE user_id = ${this.userId}
          AND tokens_used_month + ${tokens} <= ${limit}
      `);
      // node-postgres + drizzle expose rowCount on the result; some
      // drivers return rowsAffected. Probe both for safety. If the
      // driver returns nothing, fall through (we still emitted the
      // UPDATE; better to under-block than to falsely reject).
      const rowCount = result?.rowCount ?? result?.rowsAffected ?? null;
      if (rowCount === 0) {
        throw new Error('Insufficient credits — would exceed monthly limit');
      }
      return { committed: tokens };
    }
    await client
      .update(userBilling)
      .set({
        tokensUsedMonth: sql`${userBilling.tokensUsedMonth} + ${tokens}`,
        updatedAt: new Date(),
      })
      .where(eq(userBilling.userId, this.userId));
    return { committed: tokens };
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
