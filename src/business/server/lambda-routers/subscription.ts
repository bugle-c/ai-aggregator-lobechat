import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { UserModel } from '@/database/models/user';
import { userBilling } from '@/database/schemas';
import { CANCELLATION_REASON_CODES, cancellationSurveys } from '@/database/schemas/lifecycle';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { createYookassaPayment } from '@/server/modules/billing/yookassa';
import { BillingService } from '@/server/services/billing';

const billingProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: { billingService: new BillingService(ctx.serverDB, ctx.userId) },
  });
});

export const subscriptionRouter = router({
  createPayment: billingProcedure
    .input(
      z.object({
        planId: z.number(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const plan = await ctx.billingService.getPlanById(input.planId);
      if (!plan) throw new Error('Plan not found');
      if (plan.priceRub === 0) throw new Error('Cannot purchase free plan');

      const ubRow = await ctx.serverDB
        .select({ tgBotChatId: userBilling.tgBotChatId })
        .from(userBilling)
        .where(eq(userBilling.userId, ctx.userId))
        .then((r) => r[0]);

      const tgChatId = ubRow?.tgBotChatId ?? null;

      const payment = await ctx.billingService.createPayment({
        amountRub: plan.priceRub,
        metadata: {
          ...(ctx.pricingVariant ? { pricing_variant: ctx.pricingVariant } : {}),
          sbp_preselected: true,
          tg_user_id: tgChatId,
        },
        planId: plan.id,
        type: 'subscription',
      });

      // Single return_url for both success and abandon paths — YooKassa
      // doesn't separate them. We attach the local payment id so the
      // landing page can look up the true status server-side and either
      // celebrate (succeeded) or fire the recovery flow (canceled /
      // expired / still pending). See Plans.tsx → recoveryFor handling.
      const returnUrl = `${process.env.APP_URL || 'https://ask.gptweb.ru'}/settings/plans?recoveryFor=${payment.id}`;

      const user = await UserModel.findById(ctx.serverDB, ctx.userId);

      const { paymentId, paymentUrl } = await createYookassaPayment({
        amountRub: plan.priceRub,
        customerEmail: user?.email || undefined,
        description: `Подписка ${plan.name} — WebGPT`,
        metadata: {
          payment_id: payment.id,
          type: 'subscription',
          ...(ctx.pricingVariant ? { pricing_variant: ctx.pricingVariant } : {}),
        },
        // NB: NO paymentMethodType for subscriptions.
        //
        // SBP is logically incompatible with `save_payment_method: true` —
        // SBP is a one-shot QR scan, there's no card token to save for
        // recurring charges. YooKassa rejects the combination with 403
        // "This store can't make recurring payments" (misleading message —
        // the real reason is the SBP/save-method conflict, not shop config).
        //
        // Top-ups (one-shot) DO get SBP preselect — see topUp.ts. They
        // don't pass savePaymentMethod, so the conflict doesn't arise.
        //
        // Subscriptions need a saveable method = bank card. YK's hosted
        // form still shows SBP as an option, but bank_card is the default
        // because we don't preselect anything here.
        returnUrl,
        // Saves the card token on first payment so the
        // renew-due-subscriptions cron can charge the user each cycle
        // without bouncing them back to the YooKassa checkout. The
        // succeeded-webhook persists `payment_method.id` to
        // user_billing.payment_method_id.
        //
        // Requires the YooKassa store to be approved for recurring
        // payments. Without that approval, including the flag makes YK
        // reject the whole payment with 403 'forbidden'. Gate it behind
        // an env so we can ship subscriptions before recurring is
        // approved, and flip it on later without code changes.
        savePaymentMethod: process.env.YOOKASSA_RECURRING_ENABLED === '1',
      });

      await BillingService.updatePaymentYookassaId(ctx.serverDB, payment.id, paymentId);

      return { paymentUrl };
    }),

  getBillingState: billingProcedure.query(async ({ ctx }) => {
    const billing = await ctx.billingService.getOrResetUserBilling();
    const plan = await ctx.billingService.getPlanById(billing.planId);
    return {
      creditBalance: billing.tokenBalance,
      creditLimit: plan?.tokenLimit || 50,
      creditsUsed: billing.tokensUsedMonth,
      plan: plan || null,
      subscriptionExpiresAt: billing.subscriptionExpiresAt,
      autoRenew: billing.autoRenew,
      cancelledAt: billing.cancelledAt,
      hasSavedPaymentMethod: !!billing.paymentMethodId,
    };
  }),

  getPlans: billingProcedure.query(async ({ ctx }) => {
    return ctx.billingService.getActivePlans();
  }),

  getPayments: billingProcedure.query(async ({ ctx }) => {
    return ctx.billingService.getUserPayments();
  }),

  /**
   * Phase 2.3 — record a cancellation reason from the user.
   *
   * Inserts a row into `cancellation_surveys` snapshotting the user's
   * current paid plan id. Does NOT itself perform the cancellation: paid
   * subscriptions today expire passively when not renewed, so the survey
   * is a pure data-capture endpoint. Wire it from the (future) "Cancel
   * subscription" UX flow in /settings/plans, or from a churn-prevention
   * email link.
   */
  submitCancellationSurvey: billingProcedure
    .input(
      z.object({
        reasonCode: z.enum(CANCELLATION_REASON_CODES),
        reasonText: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const billing = await ctx.billingService.getOrCreateUserBilling();
      await ctx.serverDB.insert(cancellationSurveys).values({
        userId: ctx.userId,
        reasonCode: input.reasonCode,
        reasonText: input.reasonText ?? null,
        planIdBefore: billing.planId,
      });
      return { ok: true };
    }),

  /**
   * User-initiated subscription cancellation.
   *
   * Flips `auto_renew=false` and stamps `cancelled_at` / `cancel_reason_code`
   * on `user_billing`. Subscription stays active until
   * `subscription_expires_at` — the user keeps everything they paid for
   * through that date. The renew-due-subscriptions cron skips this row
   * because of the `auto_renew=true` filter, so no further charges.
   *
   * Also writes the cancellation_surveys row in the same call so we have
   * one explicit "user clicked cancel" event with reason. Re-subscribing
   * by paying again clears these flags via fulfillPayment().
   */
  cancelSubscription: billingProcedure
    .input(
      z.object({
        reasonCode: z.enum(CANCELLATION_REASON_CODES),
        reasonText: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { userBilling } = await import('@/database/schemas');
      const { eq } = await import('drizzle-orm');
      const { writeSubscriptionEvent } =
        await import('@/server/modules/analytics/writeSubscriptionEvent');
      const billing = await ctx.billingService.getOrCreateUserBilling();

      if (billing.planId === 1) {
        throw new Error('Подписка не активна — отменять нечего.');
      }

      const fromPlan = await ctx.billingService.getPlanById(billing.planId);

      await ctx.serverDB
        .update(userBilling)
        .set({
          autoRenew: false,
          cancelledAt: new Date(),
          cancelReasonCode: input.reasonCode,
        })
        .where(eq(userBilling.userId, ctx.userId));

      await ctx.serverDB.insert(cancellationSurveys).values({
        userId: ctx.userId,
        reasonCode: input.reasonCode,
        reasonText: input.reasonText ?? null,
        planIdBefore: billing.planId,
      });

      // Phase 2.4 — record a `cancelled` event in billing_subscription_events
      // so the MRR chart in /admin/finance, churn rate in /economics, and
      // cohort retention all see this opt-out. Without this the row only
      // exists in user_billing.cancelled_at, which the analytics dashboard
      // never reads. classifySubscriptionEvent emits eventType='cancelled'
      // with mrrDelta=-fromPlanPrice when toPlanPrice is 0 — passing 0 +
      // toPlanId=1 (free) reflects "user opted out of recurring billing;
      // after subscriptionExpiresAt they fall to free".
      await writeSubscriptionEvent(ctx.serverDB, {
        userId: ctx.userId,
        fromPlanId: billing.planId,
        toPlanId: 1,
        fromPlanPrice: fromPlan?.priceRub ?? 0,
        toPlanPrice: 0,
        currentExpiresAt: billing.subscriptionExpiresAt ?? null,
        paymentId: null,
      });

      return {
        ok: true,
        activeUntil: billing.subscriptionExpiresAt,
      };
    }),

  /**
   * User removes their saved card. Clears `payment_method_id` so the
   * renew-due-subscriptions cron can no longer auto-charge. Doesn't
   * cancel the current subscription window — paid access remains until
   * `subscription_expires_at`.
   *
   * Required by YooKassa for recurring-payments approval: there must
   * be a self-service flow where the user can revoke the saved card.
   */
  removePaymentMethod: billingProcedure.mutation(async ({ ctx }) => {
    const { userBilling } = await import('@/database/schemas');
    const { eq } = await import('drizzle-orm');

    const billing = await ctx.billingService.getOrCreateUserBilling();
    if (!billing.paymentMethodId) {
      return { ok: true, alreadyRemoved: true };
    }

    await ctx.serverDB
      .update(userBilling)
      .set({
        paymentMethodId: null,
        autoRenew: false,
      })
      .where(eq(userBilling.userId, ctx.userId));

    return { ok: true };
  }),

  /**
   * Read the status of a specific billing_payments row. Called from
   * the post-YooKassa landing on /settings/plans?recoveryFor=<id> to
   * decide whether to congratulate the user, poll a bit longer (webhook
   * usually lags ~1-2s), or fire the recovery modal.
   *
   * Returns null when the id doesn't belong to the current user — keeps
   * the endpoint safe against scraping arbitrary payment ids.
   */
  getPaymentStatus: billingProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const { and, eq } = await import('drizzle-orm');
      const { billingPayments, billingPlans } = await import('@/database/schemas');
      const rows = await ctx.serverDB
        .select({
          amountRub: billingPayments.amountRub,
          createdAt: billingPayments.createdAt,
          id: billingPayments.id,
          planId: billingPayments.planId,
          planName: billingPlans.name,
          planSlug: billingPlans.slug,
          status: billingPayments.status,
        })
        .from(billingPayments)
        .leftJoin(billingPlans, eq(billingPlans.id, billingPayments.planId))
        .where(and(eq(billingPayments.id, input.id), eq(billingPayments.userId, ctx.userId)))
        .limit(1);
      return rows[0] ?? null;
    }),

  /**
   * Surfaces the user's most recent abandoned/failed checkout in the
   * last 24 hours so the client can show a recovery pop-up («Не
   * закончили оплату?» → продолжить / промокод / поддержка). Excludes
   * succeeded ones — those don't need recovery.
   *
   * Returns null when there is no candidate.
   */
  getRecentFailedAttempt: billingProcedure.query(async ({ ctx }) => {
    const { and, desc, eq, gt, inArray } = await import('drizzle-orm');
    const { billingPayments, billingPlans } = await import('@/database/schemas');

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await ctx.serverDB
      .select({
        amountRub: billingPayments.amountRub,
        createdAt: billingPayments.createdAt,
        paymentId: billingPayments.id,
        planId: billingPayments.planId,
        planName: billingPlans.name,
        planSlug: billingPlans.slug,
        status: billingPayments.status,
      })
      .from(billingPayments)
      .leftJoin(billingPlans, eq(billingPlans.id, billingPayments.planId))
      .where(
        and(
          eq(billingPayments.userId, ctx.userId),
          eq(billingPayments.type, 'subscription'),
          inArray(billingPayments.status, ['canceled', 'failed', 'pending']),
          gt(billingPayments.createdAt, since),
        ),
      )
      .orderBy(desc(billingPayments.createdAt))
      .limit(1);

    return rows[0] ?? null;
  }),
});
