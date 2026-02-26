import { type LobeChatDatabase } from '@/database/type';
import { BillingService } from '@/server/services/billing';

export async function fulfillPayment(
  db: LobeChatDatabase,
  yookassaPaymentId: string,
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
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    await billingService.getOrCreateUserBilling();
    await billingService.updatePlan(payment.planId, expiresAt);
    console.info(`[billing] Subscription activated: user=${payment.userId} plan=${payment.planId}`);
  } else if (payment.type === 'topup' && payment.tokensAmount) {
    await billingService.getOrCreateUserBilling();
    await billingService.addTokenBalance(payment.tokensAmount);
    console.info(
      `[billing] Topup fulfilled: user=${payment.userId} tokens=${payment.tokensAmount}`,
    );
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
