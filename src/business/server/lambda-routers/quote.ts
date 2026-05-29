/**
 * Cost-preview tRPC router.
 *
 * Exposes per-model credit estimates for image and video generation so the
 * UI can show "Sparkles 128" on the generate button before the user commits
 * to a request. Re-uses the same `calculateCreditsAsync` math the actual
 * charge path uses, so the preview can never disagree with the final bill
 * (the floor is identical: `Math.ceil(costRub / CREDIT_VALUE_RUB)` with the
 * tier multiplier from rates-source).
 *
 * Why server-side preview (not a client-side rate cache):
 * - Tier multipliers are user-specific (free / basic / pro) and require
 *   reading the user's plan to apply correctly. Doing this on the client
 *   would expose the rate table and risk divergence if we later add
 *   per-user discounts or promo overlays.
 * - The Supabase `model_rates` table is the source of truth; cloning the
 *   formula client-side would force every billing change to land in two
 *   places.
 *
 * The endpoints are queries (not mutations), debounced from the client at
 * 300ms, and cheap to call — ~10ms cache hit on the rates cache.
 */
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { calculateCreditsAsync } from '@/server/modules/billing/model-rates';
import { BillingService } from '@/server/services/billing';

const billingProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: { billingService: new BillingService(ctx.serverDB, ctx.userId) },
  });
});

interface QuoteResult {
  /** Sum of regular token_balance + active bonus_balance. */
  balance: number;
  /** Total credits the request will cost (matches what the charge path bills). */
  credits: number;
  /** Whether the user can afford this generation right now. */
  sufficient: boolean;
}

async function buildQuote(
  ctx: { billingService: BillingService },
  modelId: string,
  credits: number,
): Promise<QuoteResult> {
  const billing = await ctx.billingService.getOrResetUserBilling();
  // Bonus pool can be consumed alongside the regular balance. Both
  // contribute to "can the user afford this", matching the chargeBefore
  // behaviour. Ignore bonus if it's already past its expiry.
  const bonusActive =
    !billing.bonusBalanceExpiresAt ||
    new Date(billing.bonusBalanceExpiresAt).getTime() > Date.now();
  const balance = (billing.tokenBalance ?? 0) + (bonusActive ? (billing.bonusBalance ?? 0) : 0);
  return {
    balance,
    credits,
    sufficient: balance >= credits,
  };
}

export const quoteRouter = router({
  /**
   * Estimate credits for an image generation request.
   *
   * `params.images` defaults to 1 to match the runtime: the image router
   * only batches multi-image when the model card explicitly requests it,
   * which most don't.
   */
  imageCost: billingProcedure
    .input(
      z.object({
        model: z.string().min(1),
        params: z
          .object({
            images: z.number().int().positive().max(10).optional(),
          })
          .optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const images = input.params?.images ?? 1;
      const credits = await calculateCreditsAsync(input.model, { images, kind: 'image' });
      return buildQuote(ctx, input.model, credits);
    }),

  /**
   * Estimate credits for a video generation request.
   *
   * `durationSeconds` is required because all WaveSpeed video models bill
   * per second. Passing 0 would surface a misleading "0 кр" preview, so
   * the schema forces ≥1.
   */
  videoCost: billingProcedure
    .input(
      z.object({
        durationSeconds: z.number().int().min(1).max(60),
        model: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const credits = await calculateCreditsAsync(input.model, {
        kind: 'video',
        videoSeconds: input.durationSeconds,
      });
      return buildQuote(ctx, input.model, credits);
    }),
});
