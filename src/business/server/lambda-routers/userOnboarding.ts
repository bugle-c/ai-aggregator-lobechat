import { eq } from 'drizzle-orm';

import { userOnboarding } from '@/database/schemas';
import type { UserOnboardingItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const onboardingProcedure = authedProcedure.use(serverDatabase);

const fetchOrCreate = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<UserOnboardingItem> => {
  const rows = await db.select().from(userOnboarding).where(eq(userOnboarding.userId, userId)).limit(1);
  if (rows[0]) return rows[0];

  await db.insert(userOnboarding).values({ userId }).onConflictDoNothing({ target: userOnboarding.userId });

  const created = await db
    .select()
    .from(userOnboarding)
    .where(eq(userOnboarding.userId, userId))
    .limit(1);
  return created[0]!;
};

export const userOnboardingRouter = router({
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
});
