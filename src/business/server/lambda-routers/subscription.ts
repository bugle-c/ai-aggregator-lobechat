import { z } from 'zod';

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
        planId: plan.id,
        type: 'subscription',
      });

      const returnUrl = `${process.env.APP_URL || 'https://ask.gptweb.ru'}/settings/billing?payment=success`;

      const { paymentId, paymentUrl } = await createYookassaPayment({
        amountRub: plan.priceRub,
        description: `Подписка ${plan.name} — WebGPT`,
        metadata: { payment_id: payment.id, type: 'subscription' },
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
});
