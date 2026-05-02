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
        // Saves the card token on first payment so the
        // renew-due-subscriptions cron can charge the user each cycle
        // without bouncing them back to the YooKassa checkout. The
        // succeeded-webhook persists `payment_method.id` to
        // user_billing.payment_method_id.
        savePaymentMethod: true,
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
      autoRenew: billing.autoRenew,
      cancelledAt: billing.cancelledAt,
      hasSavedPaymentMethod: !!billing.paymentMethodId,
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

  /**
   * User-initiated subscription cancellation.
   *
   * Flips `auto_renew=false` and stamps `cancelled_at` / `cancel_reason_code`
   * on `user_billing`. Subscription stays active until
   * `subscription_expires_at` — the user keeps everything they paid for
   * through that date. The renew-due-subscriptions cron skips this row
   * because of the `auto_renew=true` filter, so no further charges.
   *
   * Also writes the cancellation_surveys row in the same call so we have
   * one explicit "user clicked cancel" event with reason. Re-subscribing
   * by paying again clears these flags via fulfillPayment().
   */
  cancelSubscription: billingProcedure
    .input(
      z.object({
        reasonCode: z.enum(CANCELLATION_REASON_CODES),
        reasonText: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { userBilling } = await import('@/database/schemas');
      const { eq } = await import('drizzle-orm');
      const billing = await ctx.billingService.getOrCreateUserBilling();

      if (billing.planId === 1) {
        throw new Error('Подписка не активна — отменять нечего.');
      }

      await ctx.serverDB
        .update(userBilling)
        .set({
          autoRenew: false,
          cancelledAt: new Date(),
          cancelReasonCode: input.reasonCode,
        })
        .where(eq(userBilling.userId, ctx.userId));

      await ctx.serverDB.insert(cancellationSurveys).values({
        userId: ctx.userId,
        reasonCode: input.reasonCode,
        reasonText: input.reasonText ?? null,
        planIdBefore: billing.planId,
      });

      return {
        ok: true,
        activeUntil: billing.subscriptionExpiresAt,
      };
    }),
});
