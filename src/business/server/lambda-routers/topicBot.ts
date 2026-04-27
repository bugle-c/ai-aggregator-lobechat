import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { topics } from '@/database/schemas';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

/**
 * Bot-specific topic operations exposed to the Telegram bot via tRPC.
 *
 * Lives in its own router (`topicBot`) to keep clean separation from the main
 * `topic` router (which has its own surface for the web UI).
 */
const procedure = authedProcedure.use(serverDatabase);

export const topicBotRouter = router({
  /**
   * Hard-delete a topic — only if it belongs to the current authed user.
   * Used by the bot's /history `🗑` action.
   */
  delete: procedure
    .input(z.object({ topicId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const found = await ctx.serverDB.query.topics.findFirst({
        where: eq(topics.id, input.topicId),
      });
      if (!found || found.userId !== ctx.userId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'topic_not_found' });
      }
      await ctx.serverDB
        .delete(topics)
        .where(and(eq(topics.id, input.topicId), eq(topics.userId, ctx.userId)));
      return { ok: true as const };
    }),

  /**
   * Return last N topics for the current user, newest first.
   * Used by the bot's /history command.
   */
  getRecent: procedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(10) }))
    .query(async ({ input, ctx }) => {
      const rows = await ctx.serverDB.query.topics.findMany({
        where: eq(topics.userId, ctx.userId),
        orderBy: [desc(topics.updatedAt)],
        limit: input.limit,
      });
      return rows.map((r) => ({
        id: r.id,
        title: r.title || 'Без названия',
        updatedAt: r.updatedAt,
      }));
    }),
});
