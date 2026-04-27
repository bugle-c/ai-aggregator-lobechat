import { TRPCError } from '@trpc/server';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { billingPlans, promoCodes, promoRedemptions, userBilling } from '@/database/schemas';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const promoProcedure = authedProcedure.use(serverDatabase);

export const promoRouter = router({
  redeem: promoProcedure
    .input(z.object({ code: z.string().min(1).max(64) }))
    .mutation(async ({ input, ctx }) => {
      return ctx.serverDB.transaction(async (tx) => {
        const code = input.code.toUpperCase();

        // 1. Lookup active promo
        const promoRows = await tx
          .select()
          .from(promoCodes)
          .where(and(eq(promoCodes.code, code), eq(promoCodes.isActive, true)))
          .limit(1);

        const promo = promoRows[0];
        if (!promo) throw new TRPCError({ code: 'NOT_FOUND', message: 'code_not_found' });

        // 2. Check expiry
        if (promo.expiresAt && promo.expiresAt < new Date())
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'code_expired' });

        // 3. Check max uses
        if (promo.usedCount >= promo.maxUses)
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'code_max_uses_reached' });

        // 4. Check already redeemed by this user
        const existingRows = await tx
          .select()
          .from(promoRedemptions)
          .where(
            and(eq(promoRedemptions.promoId, promo.id), eq(promoRedemptions.userId, ctx.userId)),
          )
          .limit(1);

        if (existingRows[0])
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'code_already_redeemed' });

        // 5. Insert redemption record
        await tx
          .insert(promoRedemptions)
          .values({ promoId: promo.id, userId: ctx.userId })
          .onConflictDoNothing();

        // 6. Increment used_count
        await tx
          .update(promoCodes)
          .set({ usedCount: sql`${promoCodes.usedCount} + 1` })
          .where(eq(promoCodes.id, promo.id));

        // 7. Ensure user_billing row exists (UPSERT — safe for new users)
        await tx
          .insert(userBilling)
          .values({ userId: ctx.userId })
          .onConflictDoNothing({ target: userBilling.userId });

        // 8. Apply promo effect
        if (promo.type === 'token_bonus') {
          if (!promo.tokenAmount)
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'invalid_promo_config' });

          await tx
            .update(userBilling)
            .set({
              tokenBalance: sql`${userBilling.tokenBalance} + ${promo.tokenAmount}`,
              updatedAt: new Date(),
            })
            .where(eq(userBilling.userId, ctx.userId));

          return {
            message: `+${promo.tokenAmount} кредитов`,
            tokensAdded: promo.tokenAmount,
            type: 'token_bonus' as const,
          };
        }

        if (promo.type === 'plan_upgrade') {
          if (!promo.planId || !promo.durationDays)
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'invalid_promo_config' });

          const planRows = await tx
            .select()
            .from(billingPlans)
            .where(eq(billingPlans.id, promo.planId))
            .limit(1);

          const plan = planRows[0];
          const expires = new Date(Date.now() + promo.durationDays * 86_400_000);

          await tx
            .update(userBilling)
            .set({
              planId: promo.planId,
              subscriptionExpiresAt: expires,
              updatedAt: new Date(),
            })
            .where(eq(userBilling.userId, ctx.userId));

          return {
            expiresAt: expires.toISOString(),
            message: `Тариф «${plan?.name ?? 'обновлён'}» на ${promo.durationDays} дней`,
            planName: plan?.name ?? null,
            type: 'plan_upgrade' as const,
          };
        }

        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'invalid_promo_config' });
      });
    }),
});
