import { eq } from 'drizzle-orm';

import { billingPayments, userBilling } from '@/database/schemas';
import { type LobeChatDatabase } from '@/database/type';
import { writeSubscriptionEvent } from '@/server/modules/analytics/writeSubscriptionEvent';
import { sendSubscriptionConfirmation } from '@/server/modules/lifecycle/sendConfirmation';
import { rewardReferralsOnFirstPayment } from '@/server/modules/referrals/rewardOnFirstPayment';
import { BillingService } from '@/server/services/billing';

export interface FulfillOptions {
  /**
   * `payment_method.id` from the YooKassa webhook when the payment was
   * created with `save_payment_method: true`. Persisted on
   * user_billing.payment_method_id so the renew-due-subscriptions cron
   * can charge the same card on each cycle without redirecting the user.
   */
  savedPaymentMethodId?: string;
}

export async function fulfillPayment(
  db: LobeChatDatabase,
  yookassaPaymentId: string,
  options: FulfillOptions = {},
): Promise<void> {
  const payment = await BillingService.getPaymentByYookassaId(db, yookassaPaymentId);
  if (!payment) {
    console.error(`[billing] Payment not found for YooKassa ID: ${yookassaPaymentId}`);
    return;
  }
  if (payment.status === 'succeeded') return;

  await BillingService.updatePaymentStatus(db, payment.id, 'succeeded');

  const billingService = new BillingService(db, payment.userId);

  if (payment.type === 'subscription' && payment.planId) {
    // Capture pre-change state for subscription event classification
    const currentBilling = await billingService.getOrCreateUserBilling();
    const fromPlanId = currentBilling.planId;
    const fromPlan = await billingService.getPlanById(fromPlanId);
    const toPlan = await billingService.getPlanById(payment.planId);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    await billingService.updatePlan(payment.planId, expiresAt);

    // Persist the saved payment method (if YooKassa returned one) so the
    // auto-renew cron can charge the same card on each cycle. Also clear
    // any prior cancellation flags — a fresh subscription payment
    // implicitly re-opts into auto-renewal.
    if (options.savedPaymentMethodId) {
      await db
        .update(userBilling)
        .set({
          paymentMethodId: options.savedPaymentMethodId,
          autoRenew: true,
          cancelledAt: null,
          cancelReasonCode: null,
        })
        .where(eq(userBilling.userId, payment.userId));
      console.info(
        `[billing] Saved payment method for user=${payment.userId} method_id=${options.savedPaymentMethodId.slice(0, 8)}…`,
      );
    } else if (currentBilling.cancelledAt) {
      // Recurring renewal payment — webhook usually omits the saved-flag
      // because the method was saved on the original. Still clear stale
      // cancellation flags from a previous cycle.
      await db
        .update(userBilling)
        .set({ autoRenew: true, cancelledAt: null, cancelReasonCode: null })
        .where(eq(userBilling.userId, payment.userId));
    }

    await writeSubscriptionEvent(db, {
      userId: payment.userId,
      fromPlanId,
      toPlanId: payment.planId,
      fromPlanPrice: fromPlan?.priceRub ?? 0,
      toPlanPrice: toPlan?.priceRub ?? 0,
      currentExpiresAt: currentBilling.subscriptionExpiresAt ?? null,
      paymentId: payment.id,
    });

    // Flag for bot notification sweep (cron notify-bot-pending will deliver)
    await db
      .update(billingPayments)
      .set({ botNotifyPending: true })
      .where(eq(billingPayments.id, payment.id));

    console.info(`[billing] Subscription activated: user=${payment.userId} plan=${payment.planId}`);

    // Phase 2.3 — fire-and-forget confirmation email. Wrapped: email never
    // breaks fulfill.
    try {
      await sendSubscriptionConfirmation(db, {
        userId: payment.userId,
        planName: toPlan?.name ?? 'WebGPT',
        expiresAt,
        creditAmount: toPlan?.tokenLimit ?? 0,
      });
    } catch (error) {
      console.error('[billing] subscription confirmation email error:', error);
    }
  } else if (payment.type === 'topup' && payment.tokensAmount) {
    await billingService.getOrCreateUserBilling();
    await billingService.addTokenBalance(payment.tokensAmount);
    console.info(
      `[billing] Topup fulfilled: user=${payment.userId} credits=${payment.tokensAmount}`,
    );
  }

  // Referral rewards: triggered ONLY on the user's first successful payment.
  // The check (count succeeded == 1) lives inside rewardReferralsOnFirstPayment
  // so subsequent payments are no-ops. Wrapped in try/catch — referral rewards
  // are nice-to-have, must not break payment fulfillment if they fail.
  try {
    await rewardReferralsOnFirstPayment(db, payment.userId);
  } catch (error) {
    console.error('[billing] referral reward hook error:', error);
  }
}

export async function cancelPayment(
  db: LobeChatDatabase,
  yookassaPaymentId: string,
): Promise<void> {
  const payment = await BillingService.getPaymentByYookassaId(db, yookassaPaymentId);
  if (!payment) return;
  if (payment.status !== 'pending') return;
  await BillingService.updatePaymentStatus(db, payment.id, 'canceled');
  console.info(`[billing] Payment canceled: ${yookassaPaymentId}`);
}
