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
});
