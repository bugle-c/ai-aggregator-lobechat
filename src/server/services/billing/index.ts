import { desc, eq, sql } from 'drizzle-orm';

import type { BillingPaymentItem, NewBillingPayment, UserBillingItem } from '@/database/schemas';
import { billingPayments, userBilling } from '@/database/schemas';
import { type LobeChatDatabase } from '@/database/type';

import { type PlanView, fetchActivePlans, fetchPlanById } from './plans-source';

export type { PlanView };

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
    const billing = await this.getOrCreateUserBilling();

    // Lazy monthly reset: if monthStart is before the start of the current month,
    // reset tokensUsedMonth to 0 and update monthStart
    const currentMonthStart = new Date();
    currentMonthStart.setDate(1);
    currentMonthStart.setHours(0, 0, 0, 0);

    if (billing.monthStart < currentMonthStart) {
      const updated = await this.db
        .update(userBilling)
        .set({
          monthStart: currentMonthStart,
          tokensUsedMonth: 0,
          updatedAt: new Date(),
        })
        .where(eq(userBilling.userId, this.userId))
        .returning();

      return updated[0]!;
    }

    return billing;
  };

  getUserPlanSlug = async (): Promise<string> => {
    const billing = await this.getOrResetUserBilling();
    const plan = await this.getPlanById(billing.planId);
    return plan?.slug || 'free';
  };

  updatePlan = async (planId: number, expiresAt: Date | null): Promise<void> => {
    await this.db
      .update(userBilling)
      .set({
        planId,
        subscriptionExpiresAt: expiresAt,
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

  incrementTokensUsed = async (tokens: number): Promise<void> => {
    await this.db
      .update(userBilling)
      .set({
        tokensUsedMonth: sql`${userBilling.tokensUsedMonth} + ${tokens}`,
        updatedAt: new Date(),
      })
      .where(eq(userBilling.userId, this.userId));
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
