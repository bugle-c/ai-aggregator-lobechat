import { z } from 'zod';

import { UserModel } from '@/database/models/user';
import { CANCELLATION_REASON_CODES, cancellationSurveys } from '@/database/schemas/lifecycle';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { createYookassaPayment } from '@/server/modules/billing/yookassa';
import { BillingService } from '@/server/services/billing';

const billingProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: { billingService: new BillingService(ctx.serverDB, ctx.userId) },
  });
});

export const subscriptionRouter = router({
  createPayment: billingProcedure
    .input(
      z.object({
        planId: z.number(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const plan = await ctx.billingService.getPlanById(input.planId);
      if (!plan) throw new Error('Plan not found');
      if (plan.priceRub === 0) throw new Error('Cannot purchase free plan');

      const payment = await ctx.billingService.createPayment({
        amountRub: plan.priceRub,
        metadata: ctx.pricingVariant ? { pricing_variant: ctx.pricingVariant } : null,
        planId: plan.id,
        type: 'subscription',
      });

      const returnUrl = `${process.env.APP_URL || 'https://ask.gptweb.ru'}/settings/billing?payment=success`;

      const user = await UserModel.findById(ctx.serverDB, ctx.userId);

      const { paymentId, paymentUrl } = await createYookassaPayment({
        amountRub: plan.priceRub,
        customerEmail: user?.email || undefined,
        description: `Подписка ${plan.name} — WebGPT`,
        metadata: {
          payment_id: payment.id,
          type: 'subscription',
          ...(ctx.pricingVariant ? { pricing_variant: ctx.pricingVariant } : {}),
        },
        returnUrl,
      });

      await BillingService.updatePaymentYookassaId(ctx.serverDB, payment.id, paymentId);

      return { paymentUrl };
    }),

  getBillingState: billingProcedure.query(async ({ ctx }) => {
    const billing = await ctx.billingService.getOrResetUserBilling();
    const plan = await ctx.billingService.getPlanById(billing.planId);
    return {
      creditBalance: billing.tokenBalance,
      creditLimit: plan?.tokenLimit || 50,
      creditsUsed: billing.tokensUsedMonth,
      plan: plan || null,
      subscriptionExpiresAt: billing.subscriptionExpiresAt,
    };
  }),

  getPlans: billingProcedure.query(async ({ ctx }) => {
    return ctx.billingService.getActivePlans();
  }),

  getPayments: billingProcedure.query(async ({ ctx }) => {
    return ctx.billingService.getUserPayments();
  }),

  /**
   * Phase 2.3 — record a cancellation reason from the user.
   *
   * Inserts a row into `cancellation_surveys` snapshotting the user's
   * current paid plan id. Does NOT itself perform the cancellation: paid
   * subscriptions today expire passively when not renewed, so the survey
   * is a pure data-capture endpoint. Wire it from the (future) "Cancel
   * subscription" UX flow in /settings/plans, or from a churn-prevention
   * email link.
   */
  submitCancellationSurvey: billingProcedure
    .input(
      z.object({
        reasonCode: z.enum(CANCELLATION_REASON_CODES),
        reasonText: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const billing = await ctx.billingService.getOrCreateUserBilling();
      await ctx.serverDB.insert(cancellationSurveys).values({
        userId: ctx.userId,
        reasonCode: input.reasonCode,
        reasonText: input.reasonText ?? null,
        planIdBefore: billing.planId,
      });
      return { ok: true };
    }),
});
