import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  billingPlans,
  billingSubscriptionEvents,
  upsellClicks,
  upsellImpressions,
  userBilling,
} from '@/database/schemas';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { resolveExpiredPlanNotice } from '@/server/modules/lifecycle/expiringSubscriptions';

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
  'expired_banner',
] as const;

const procedure = authedProcedure.use(serverDatabase);

export const upsellRouter = router({
  /**
   * In-app «Тариф закончился — продлить» banner (Fix 3). Non-null only
   * while the user sits on the free plan and their latest subscription
   * event is an expiry younger than EXPIRED_BANNER_WINDOW_DAYS. Dismissal
   * is client-side, keyed by `eventId`, so one expiry = one banner.
   */
  getExpiredPlanNotice: procedure.query(async ({ ctx }) => {
    const [billing] = await ctx.serverDB
      .select({ planId: userBilling.planId })
      .from(userBilling)
      .where(eq(userBilling.userId, ctx.userId))
      .limit(1);
    if (!billing) return null;

    const [latestEvent] = await ctx.serverDB
      .select({
        createdAt: billingSubscriptionEvents.createdAt,
        eventType: billingSubscriptionEvents.eventType,
        id: billingSubscriptionEvents.id,
        planName: billingPlans.name,
      })
      .from(billingSubscriptionEvents)
      .leftJoin(billingPlans, eq(billingPlans.id, billingSubscriptionEvents.fromPlanId))
      .where(eq(billingSubscriptionEvents.userId, ctx.userId))
      .orderBy(desc(billingSubscriptionEvents.createdAt))
      .limit(1);

    return resolveExpiredPlanNotice({ latestEvent: latestEvent ?? null, planId: billing.planId });
  }),

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
