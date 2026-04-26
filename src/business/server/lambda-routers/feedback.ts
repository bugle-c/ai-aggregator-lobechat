import { z } from 'zod';

import { messageFeedback } from '@/database/schemas';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const procedure = authedProcedure.use(serverDatabase);

export const feedbackRouter = router({
  create: procedure
    .input(
      z.object({
        messageId: z.string().min(1),
        rating: z.enum(['up', 'down']),
        source: z.string().default('bot'),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Idempotent: ON CONFLICT DO UPDATE so the user can flip 👍 to 👎 and back.
      await ctx.serverDB
        .insert(messageFeedback)
        .values({
          userId: ctx.userId,
          messageId: input.messageId,
          rating: input.rating,
          source: input.source,
        })
        .onConflictDoUpdate({
          target: [messageFeedback.userId, messageFeedback.messageId],
          set: { rating: input.rating, createdAt: new Date() },
        });

      return { ok: true as const };
    }),
});
