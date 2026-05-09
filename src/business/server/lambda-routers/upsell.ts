import { z } from 'zod';

import { upsellClicks, upsellImpressions } from '@/database/schemas';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

/**
 * Allowed sources for upsell impressions/clicks.
 *
 * Keeping this enum frozen on the server (rather than `z.string()`)
 * prevents typos / abuse from polluting the funnel — clients can only
 * record events from the known set, and the admin chart in
 * `/finance/pricing-experiments` displays one row per source.
 */
const SOURCES = [
  'plan_limit_chat',
  'locked_model',
  'balance_nudge',
  'home_pill',
  'welcome_email',
] as const;

const procedure = authedProcedure.use(serverDatabase);

export const upsellRouter = router({
  recordClick: procedure
    .input(
      z.object({
        source: z.enum(SOURCES),
        targetPlan: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.serverDB.insert(upsellClicks).values({
        source: input.source,
        targetPlan: input.targetPlan ?? null,
        userId: ctx.userId,
      });
      return { ok: true };
    }),

  recordImpression: procedure
    .input(
      z.object({
        modelBlocked: z.string().optional(),
        planOffered: z.string().optional(),
        source: z.enum(SOURCES),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.serverDB.insert(upsellImpressions).values({
        modelBlocked: input.modelBlocked ?? null,
        planOffered: input.planOffered ?? null,
        source: input.source,
        userId: ctx.userId,
      });
      return { ok: true };
    }),
});
