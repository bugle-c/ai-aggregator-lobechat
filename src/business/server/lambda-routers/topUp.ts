import { z } from 'zod';

import { UserModel } from '@/database/models/user';
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

      const payment = await ctx.billingService.createPayment({
        amountRub: pkg.amountRub,
        tokensAmount: pkg.credits,
        type: 'topup',
      });

      const returnUrl = `${process.env.APP_URL || 'https://ask.gptweb.ru'}/settings/billing?payment=success`;

      const user = await UserModel.findById(ctx.serverDB, ctx.userId);

      const { paymentId, paymentUrl } = await createYookassaPayment({
        amountRub: pkg.amountRub,
        customerEmail: user?.email || undefined,
        description: `Пополнение ${pkg.label} — WebGPT`,
        metadata: { payment_id: payment.id, type: 'topup' },
        returnUrl,
      });

      await BillingService.updatePaymentYookassaId(ctx.serverDB, payment.id, paymentId);

      return { paymentUrl };
    }),

  getPackages: billingProcedure.query(() => {
    return [...TOPUP_PACKAGES];
  }),
});
