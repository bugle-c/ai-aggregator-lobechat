import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { activeBonusFor } from '@/server/modules/billing/active-bonus';
import {
  countUserMessagesSince,
  FREE_DAILY_MESSAGE_QUOTA,
  FREE_PLAN_SLUG,
  moscowDayStart,
  nextMoscowDayStart,
} from '@/server/modules/billing/daily-quota';
import {
  getRequiredPlanForModelAsync,
  isModelAllowedForPlanAsync,
} from '@/server/modules/billing/model-tiers';
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
    const totalAvailable = creditLimit + billing.tokenBalance + activeBonusFor(billing);
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
    const totalAvailable = creditLimit + billing.tokenBalance + activeBonusFor(billing);
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

    // EXP-003: free plan = N user messages per Moscow day. Drives the
    // «Осталось сегодня: 3 из 5» counter near the input; null for paid plans.
    const isFree = plan?.slug === FREE_PLAN_SLUG;
    const dailyUsed = isFree
      ? await countUserMessagesSince(ctx.serverDB, ctx.userId, moscowDayStart(now))
      : null;

    return {
      creditBalance: billing.tokenBalance,
      creditLimit,
      creditsUsed: billing.tokensUsedMonth,
      dailyQuota: isFree ? FREE_DAILY_MESSAGE_QUOTA : null,
      dailyRemaining: dailyUsed === null ? null : Math.max(0, FREE_DAILY_MESSAGE_QUOTA - dailyUsed),
      dailyResetAt: isFree ? nextMoscowDayStart(now).toISOString() : null,
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

  // Locked-model UX — returns whether the given modelId is locked for the
  // current user's plan, plus details on the required plan (name + price)
  // so the upsell modal can render a CTA without a second roundtrip.
  requiredPlanForModel: billingProcedure
    .input(z.object({ modelId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      try {
        const currentPlanSlug = await ctx.billingService.getUserPlanSlug();
        const allowed = await isModelAllowedForPlanAsync(input.modelId, currentPlanSlug);
        if (allowed) {
          return { isLocked: false as const, requiredPlan: null };
        }

        const requiredPlanSlug = await getRequiredPlanForModelAsync(input.modelId);
        const plans = await ctx.billingService.getActivePlans();
        const requiredPlan = plans.find((p) => p.slug === requiredPlanSlug);

        return {
          isLocked: true as const,
          requiredPlan: requiredPlan
            ? {
                name: requiredPlan.name,
                priceRub: requiredPlan.priceRub,
                slug: requiredPlan.slug,
              }
            : { name: requiredPlanSlug, priceRub: 0, slug: requiredPlanSlug },
        };
      } catch (err) {
        // Fallback on any error (e.g., unknown modelId, DB failure) — assume unlocked
        // to prevent modal picker crashes. useModelLockState has throwOnError=false.
        return { isLocked: false as const, requiredPlan: null };
      }
    }),
});
