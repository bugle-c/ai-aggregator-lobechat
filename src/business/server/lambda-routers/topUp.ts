import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { UserModel } from '@/database/models/user';
import { userBilling } from '@/database/schemas';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { getTopupPackage, TOPUP_PACKAGES } from '@/server/modules/billing/constants';
import { createYookassaPayment } from '@/server/modules/billing/yookassa';
import { BillingService } from '@/server/services/billing';

const billingProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: { billingService: new BillingService(ctx.serverDB, ctx.userId) },
  });
});

export const topUpRouter = router({
  createPayment: billingProcedure
    .input(z.object({ amountRub: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const pkg = getTopupPackage(input.amountRub);
      if (!pkg) throw new Error('Invalid topup amount');

      const ubRow = await ctx.serverDB
        .select({ tgBotChatId: userBilling.tgBotChatId })
        .from(userBilling)
        .where(eq(userBilling.userId, ctx.userId))
        .then((r) => r[0]);

      const tgChatId = ubRow?.tgBotChatId ?? null;

      const payment = await ctx.billingService.createPayment({
        amountRub: pkg.amountRub,
        metadata: {
          ...(ctx.pricingVariant ? { pricing_variant: ctx.pricingVariant } : {}),
          sbp_preselected: true,
          tg_user_id: tgChatId,
        },
        tokensAmount: pkg.credits,
        type: 'topup',
      });

      const returnUrl = `${process.env.APP_URL || 'https://ask.gptweb.ru'}/settings/billing?payment=success`;

      const user = await UserModel.findById(ctx.serverDB, ctx.userId);

      const { paymentId, paymentUrl } = await createYookassaPayment({
        amountRub: pkg.amountRub,
        customerEmail: user?.email || undefined,
        description: `Пополнение ${pkg.label} — WebGPT`,
        metadata: {
          payment_id: payment.id,
          type: 'topup',
          ...(ctx.pricingVariant ? { pricing_variant: ctx.pricingVariant } : {}),
        },
        paymentMethodType: 'sbp',
        returnUrl,
      });

      await BillingService.updatePaymentYookassaId(ctx.serverDB, payment.id, paymentId);

      return { paymentUrl };
    }),

  getPackages: billingProcedure.query(() => {
    return [...TOPUP_PACKAGES];
  }),

  recoverFromFailure: billingProcedure
    .input(
      z.object({
        originalPaymentId: z.string().uuid(),
        method: z.enum(['sbp', 'any']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { and, eq } = await import('drizzle-orm');
      const { billingPayments, userBilling } = await import('@/database/schemas');
      const { appEnv } = await import('@/envs/app');
      const { createYookassaPayment } = await import('@/server/modules/billing/yookassa');

      const original = await ctx.serverDB
        .select()
        .from(billingPayments)
        .where(
          and(
            eq(billingPayments.id, input.originalPaymentId),
            eq(billingPayments.userId, ctx.userId),
          ),
        )
        .then((r) => r[0]);
      if (!original) throw new Error('Payment not found');

      const ub = await ctx.serverDB
        .select({ tgBotChatId: userBilling.tgBotChatId })
        .from(userBilling)
        .where(eq(userBilling.userId, ctx.userId))
        .then((r) => r[0]);

      const { UserModel } = await import('@/database/models/user');
      const user = await UserModel.findById(ctx.serverDB, ctx.userId);

      const yk = await createYookassaPayment({
        amountRub: original.amountRub,
        customerEmail: user?.email || undefined,
        description: original.type === 'subscription' ? 'Подписка (повтор)' : 'Пополнение (повтор)',
        paymentMethodType: input.method === 'sbp' ? 'sbp' : undefined,
        returnUrl: `${appEnv.APP_URL}/?payment=success`,
        savePaymentMethod: original.type === 'subscription',
      });

      await ctx.serverDB.insert(billingPayments).values({
        amountRub: original.amountRub,
        metadata: {
          pricing_variant: (original.metadata as any)?.pricing_variant,
          recovery_from: original.id,
          recovery_method_used: 'site_modal',
          sbp_preselected: input.method === 'sbp',
          tg_user_id: ub?.tgBotChatId ?? null,
        },
        planId: original.planId,
        status: 'pending',
        tokensAmount: original.tokensAmount,
        type: original.type,
        userId: ctx.userId,
        yookassaPaymentId: yk.paymentId,
      });

      return { paymentUrl: yk.paymentUrl };
    }),

  getRecentFailure: billingProcedure.query(async ({ ctx }) => {
    const { and, desc, eq, gt, inArray } = await import('drizzle-orm');
    const { billingPayments } = await import('@/database/schemas');

    const row = await ctx.serverDB
      .select({
        id: billingPayments.id,
        amountRub: billingPayments.amountRub,
        status: billingPayments.status,
        planId: billingPayments.planId,
        tokensAmount: billingPayments.tokensAmount,
        type: billingPayments.type,
        metadata: billingPayments.metadata,
        createdAt: billingPayments.createdAt,
      })
      .from(billingPayments)
      .where(
        and(
          eq(billingPayments.userId, ctx.userId),
          inArray(billingPayments.status, ['failed', 'canceled']),
          gt(billingPayments.createdAt, new Date(Date.now() - 30 * 60 * 1000)),
        ),
      )
      .orderBy(desc(billingPayments.createdAt))
      .limit(1)
      .then((r) => r[0]);

    if (!row) return null;

    // Suppress: a later succeeded payment exists.
    const laterSuccess = await ctx.serverDB
      .select({ id: billingPayments.id })
      .from(billingPayments)
      .where(
        and(
          eq(billingPayments.userId, ctx.userId),
          eq(billingPayments.status, 'succeeded'),
          gt(billingPayments.createdAt, row.createdAt),
        ),
      )
      .limit(1)
      .then((r) => r[0]);

    if (laterSuccess) return null;

    // Suppress: bot DM already sent (avoid double-prompt).
    const meta = (row.metadata as Record<string, unknown>) ?? {};
    if (typeof meta.tg_recovery_sent === 'string') return null;

    return {
      paymentId: row.id,
      amountRub: row.amountRub,
      planId: row.planId,
      tokensAmount: row.tokensAmount,
      type: row.type,
      reasonCode: (meta.cancellation as any)?.reason ?? null,
      paymentMethodType: (meta.payment_method as any)?.type ?? null,
      cardLast4: (meta.payment_method as any)?.card_last4 ?? null,
      cardIssuerName: (meta.payment_method as any)?.card_issuer_name ?? null,
    };
  }),
});
