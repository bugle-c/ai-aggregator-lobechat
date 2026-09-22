import { reachGoal } from '@/business/client/analytics/ym';

/** Which product the payment bought — reported as the goal's `kind` param. */
export type PaymentKind = 'subscribe' | 'topup';

export const PAYMENT_SUCCESS_FIRED_PREFIX = 'webgpt_payment_success_fired:';

/**
 * Fire `payment_success` at most once per payment id.
 *
 * Two independent handlers can observe the same successful return
 * (`PaymentReturnHandler` for subscriptions, `TopUpReturnHandler` for
 * top-ups), and each of them re-runs for a few render cycles while the
 * URL param is cleared. A duplicate Metrika conversion is worse than no
 * conversion, so the guard lives in sessionStorage (survives the
 * remount a YooKassa redirect causes, dies with the tab) rather than in
 * a per-mount ref.
 *
 * Returns whether the goal was actually sent.
 */
export const firePaymentSuccessOnce = (paymentId: string, kind: PaymentKind): boolean => {
  if (!paymentId) return false;

  const key = `${PAYMENT_SUCCESS_FIRED_PREFIX}${paymentId}`;
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, '1');
  } catch {
    // Private mode / storage disabled: fall through and rely on the
    // caller's per-mount guard. Under-counting is the failure we are
    // fixing, so a best-effort fire beats silence.
  }

  reachGoal('payment_success', { kind });
  return true;
};
