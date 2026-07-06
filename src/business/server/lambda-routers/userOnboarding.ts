import { and, count, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { UserOnboardingItem } from '@/database/schemas';
import { messages, userOnboarding } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { grantMagicImagesBonus } from '@/server/modules/billing/grant-magic-images-bonus';

const onboardingProcedure = authedProcedure.use(serverDatabase);

const fetchOrCreate = async (db: LobeChatDatabase, userId: string): Promise<UserOnboardingItem> => {
  const rows = await db
    .select()
    .from(userOnboarding)
    .where(eq(userOnboarding.userId, userId))
    .limit(1);
  if (rows[0]) return rows[0];

  await db
    .insert(userOnboarding)
    .values({ userId })
    .onConflictDoNothing({ target: userOnboarding.userId });

  const created = await db
    .select()
    .from(userOnboarding)
    .where(eq(userOnboarding.userId, userId))
    .limit(1);
  return created[0]!;
};

export const userOnboardingRouter = router({
  /**
   * Server-authoritative gate for the earned free image. The user must
   * have written at least 2 meaningful messages (>= 10 chars) before the
   * one-shot magic-images bonus is granted. The grant itself is idempotent.
   */
  claimMagicBonus: onboardingProcedure.mutation(async ({ ctx }) => {
    const [row] = await ctx.serverDB
      .select({ value: count() })
      .from(messages)
      .where(
        and(
          eq(messages.userId, ctx.userId),
          eq(messages.role, 'user'),
          sql`length(${messages.content}) >= 10`,
        ),
      );

    if ((row?.value ?? 0) < 2) {
      return { alreadyClaimed: false, granted: false, reason: 'not_yet' as const };
    }

    const result = await grantMagicImagesBonus(ctx.serverDB, ctx.userId);
    return {
      alreadyClaimed: result.alreadyClaimed,
      granted: result.granted > 0,
    };
  }),

  getOnboardingState: onboardingProcedure.query(async ({ ctx }) => {
    return fetchOrCreate(ctx.serverDB, ctx.userId);
  }),

  markFirstLoginSeen: onboardingProcedure.mutation(async ({ ctx }) => {
    await fetchOrCreate(ctx.serverDB, ctx.userId);
    await ctx.serverDB
      .update(userOnboarding)
      .set({ firstLoginSeen: true, updatedAt: new Date() })
      .where(eq(userOnboarding.userId, ctx.userId));
    return { ok: true };
  }),

  markFirstMessageSeen: onboardingProcedure.mutation(async ({ ctx }) => {
    await fetchOrCreate(ctx.serverDB, ctx.userId);
    await ctx.serverDB
      .update(userOnboarding)
      .set({ firstMessageSeen: true, updatedAt: new Date() })
      .where(eq(userOnboarding.userId, ctx.userId));
    return { ok: true };
  }),

  markFirstToastSeen: onboardingProcedure.mutation(async ({ ctx }) => {
    await fetchOrCreate(ctx.serverDB, ctx.userId);
    await ctx.serverDB
      .update(userOnboarding)
      .set({ firstToastSeen: true, updatedAt: new Date() })
      .where(eq(userOnboarding.userId, ctx.userId));
    return { ok: true };
  }),

  setIntent: onboardingProcedure
    .input(z.object({ intent: z.enum(['post', 'doc', 'essay', 'ask']) }))
    .mutation(async ({ ctx, input }) => {
      await fetchOrCreate(ctx.serverDB, ctx.userId);
      await ctx.serverDB
        .update(userOnboarding)
        .set({ intent: input.intent, updatedAt: new Date() })
        .where(eq(userOnboarding.userId, ctx.userId));
      return { intent: input.intent, ok: true };
    }),

  setUiMode: onboardingProcedure
    .input(z.object({ mode: z.enum(['light', 'pro']) }))
    .mutation(async ({ ctx, input }) => {
      await fetchOrCreate(ctx.serverDB, ctx.userId);
      await ctx.serverDB
        .update(userOnboarding)
        .set({ uiMode: input.mode, updatedAt: new Date() })
        .where(eq(userOnboarding.userId, ctx.userId));
      return { ok: true, uiMode: input.mode };
    }),
});
