import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { BillingService } from '@/server/services/billing';

const billingProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: { billingService: new BillingService(ctx.serverDB, ctx.userId) },
  });
});

export const spendRouter = router({
  getUsageSummary: billingProcedure.query(async ({ ctx }) => {
    const billing = await ctx.billingService.getOrResetUserBilling();
    const plan = await ctx.billingService.getPlanById(billing.planId);
    const tokenLimit = plan?.tokenLimit || 50000;
    const totalAvailable = tokenLimit + billing.tokenBalance;
    const usagePercent =
      totalAvailable > 0 ? Math.round((billing.tokensUsedMonth / totalAvailable) * 100) : 0;

    return {
      plan: plan?.name || 'Free',
      tokenBalance: billing.tokenBalance,
      tokenLimit,
      tokensUsedMonth: billing.tokensUsedMonth,
      totalAvailable,
      usagePercent: Math.min(usagePercent, 100),
    };
  }),
});
