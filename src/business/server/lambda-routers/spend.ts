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
  // Legacy endpoint — kept for backwards compat, now returns credit-based values
  getUsageSummary: billingProcedure.query(async ({ ctx }) => {
    const billing = await ctx.billingService.getOrResetUserBilling();
    const plan = await ctx.billingService.getPlanById(billing.planId);
    const creditLimit = plan?.tokenLimit || 50;
    const totalAvailable = creditLimit + billing.tokenBalance;
    const usagePercent =
      totalAvailable > 0 ? Math.round((billing.tokensUsedMonth / totalAvailable) * 100) : 0;

    return {
      creditBalance: billing.tokenBalance,
      creditLimit,
      creditsUsed: billing.tokensUsedMonth,
      plan: plan?.name || 'Free',
      totalAvailable,
      usagePercent: Math.min(usagePercent, 100),
    };
  }),

  getCreditState: billingProcedure.query(async ({ ctx }) => {
    const billing = await ctx.billingService.getOrResetUserBilling();
    const plan = await ctx.billingService.getPlanById(billing.planId);
    const plans = await ctx.billingService.getActivePlans();
    const creditLimit = plan?.tokenLimit || 50;
    const totalAvailable = creditLimit + billing.tokenBalance;
    const usagePercent =
      totalAvailable > 0 ? Math.round((billing.tokensUsedMonth / totalAvailable) * 100) : 0;

    // Calculate days until monthly reset
    const now = new Date();
    const nextMonth = new Date(billing.monthStart);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const daysUntilReset = Math.max(
      0,
      Math.ceil((nextMonth.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
    );

    // Find next plan (one tier above current)
    const sortedPlans = plans.sort((a, b) => a.priceRub - b.priceRub);
    const currentIndex = sortedPlans.findIndex((p) => p.id === billing.planId);
    const nextPlan =
      currentIndex >= 0 && currentIndex < sortedPlans.length - 1
        ? sortedPlans[currentIndex + 1]
        : undefined;

    return {
      creditBalance: billing.tokenBalance,
      creditLimit,
      creditsUsed: billing.tokensUsedMonth,
      daysUntilReset,
      nextPlanCredits: nextPlan?.tokenLimit ?? null,
      nextPlanName: nextPlan?.name ?? null,
      nextPlanPrice: nextPlan?.priceRub ?? null,
      planName: plan?.name || 'Free',
      planSlug: plan?.slug || 'free',
      totalAvailable,
      usagePercent: Math.min(usagePercent, 100),
    };
  }),
});
