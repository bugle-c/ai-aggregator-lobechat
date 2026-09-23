import { z } from 'zod';

import {
  FREE_VIDEO_TRIAL_MODELS,
  getFreeVideoTrial,
  getNewcomerState,
} from '@/business/server/media-router/newcomer';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { activeBonusFor } from '@/server/modules/billing/active-bonus';
import { decideUsageLimit } from '@/server/modules/billing/checkUsageLimit';
import {
  countUserMessagesSince,
  FREE_DAILY_MESSAGE_QUOTA,
  FREE_PLAN_SLUG,
  moscowDayStart,
  nextMoscowDayStart,
} from '@/server/modules/billing/daily-quota';
import { paidBonusFor } from '@/server/modules/billing/intro-offer';
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

    // Newcomer mode (2026-09-22): free users in their first week default the
    // image picker to Nano Banana until they have 3 pictures. The picker reads
    // this from the credit state it already fetches.
    const newcomer = await getNewcomerState(ctx.serverDB, ctx.userId, plan?.slug, now);
    // «Одно видео на Free»: rendered by the router pool, paid in credits as usual.
    const freeVideo = await getFreeVideoTrial(ctx.serverDB, ctx.userId, plan?.slug, now);

    // Is the daily gate currently lifted by purchased credits (top-up or the
    // MAGIC48 paid bonus)? The rule lives in `decideUsageLimit` only — we ask
    // the gate itself with a probe one message past the quota, so the UI can
    // never drift from what the chat route enforces. `purchasedRemaining` is
    // the same budget the gate spends: purchase minus this month's usage.
    const bonus = activeBonusFor(billing);
    const paidBonus = isFree ? await paidBonusFor(ctx.serverDB, ctx.userId, billing, now) : 0;
    const dailyGateBypassed =
      isFree &&
      decideUsageLimit({
        bonus,
        creditLimit,
        dailyUsed: FREE_DAILY_MESSAGE_QUOTA + 1,
        kind: 'chat',
        paidBonus,
        planSlug: plan?.slug,
        tokenBalance: billing.tokenBalance,
        tokensUsedMonth: billing.tokensUsedMonth,
      }).allowed;
    const purchasedRemaining = dailyGateBypassed
      ? Math.max(0, billing.tokenBalance + paidBonus - billing.tokensUsedMonth)
      : 0;

    return {
      bonusActive: bonus,
      bonusExpiresAt: bonus > 0 ? (billing.bonusBalanceExpiresAt?.toISOString() ?? null) : null,
      creditBalance: billing.tokenBalance,
      creditLimit,
      creditsUsed: billing.tokensUsedMonth,
      dailyGateBypassed,
      dailyQuota: isFree ? FREE_DAILY_MESSAGE_QUOTA : null,
      dailyRemaining: dailyUsed === null ? null : Math.max(0, FREE_DAILY_MESSAGE_QUOTA - dailyUsed),
      dailyResetAt: isFree ? nextMoscowDayStart(now).toISOString() : null,
      daysUntilReset,
      freeVideo,
      newcomer,
      nextPlanCredits: nextPlan?.tokenLimit ?? null,
      nextPlanName: nextPlan?.name ?? null,
      nextPlanPrice: nextPlan?.priceRub ?? null,
      planName: plan?.name || 'Free',
      planSlug: plan?.slug || 'free',
      purchasedRemaining,
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
        // Free-plan video trial: the pool models are unlocked while the user
        // still has their one video (the server gate re-checks params).
        if (FREE_VIDEO_TRIAL_MODELS.has(input.modelId)) {
          const trial = await getFreeVideoTrial(ctx.serverDB, ctx.userId, currentPlanSlug);
          if (trial.left > 0) return { isLocked: false as const, requiredPlan: null };
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
