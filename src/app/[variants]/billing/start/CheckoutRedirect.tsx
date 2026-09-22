'use client';

import { memo, useEffect } from 'react';

import { reachGoal } from '@/business/client/analytics/ym';
import { recurringDisclosure } from '@/business/client/recurringDisclosure';

interface Props {
  paymentUrl: string;
  /** Plan price for the recurring disclosure; null when the lookup failed. */
  priceRub?: number | null;
}

/**
 * Client half of the /billing/start deeplink: the payment is created on the
 * server, but Metrika lives only in the browser, so the redirect to YooKassa
 * happens here — after the `checkout_start` goal has been sent (Metrika
 * callback) or after a short timeout when the tag is blocked/slow.
 */
const CheckoutRedirect = memo<Props>(({ paymentUrl, priceRub }) => {
  useEffect(() => {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      window.location.replace(paymentUrl);
    };
    reachGoal('checkout_start', { kind: 'subscribe', source: 'tg_deeplink' }, go);
    const timer = setTimeout(go, 1000);
    return () => clearTimeout(timer);
  }, [paymentUrl]);

  return (
    <div
      style={{ fontFamily: 'sans-serif', margin: '80px auto', maxWidth: 480, padding: '0 16px' }}
    >
      <p>Переходим к оплате…</p>
      {/* Recurring disclosure — this deeplink starts a subscription checkout
          that saves the card for off-session renewal charges. */}
      {priceRub != null && priceRub > 0 && (
        <p style={{ color: '#888', fontSize: 13 }}>{recurringDisclosure(priceRub)}</p>
      )}
    </div>
  );
});

CheckoutRedirect.displayName = 'CheckoutRedirect';

export default CheckoutRedirect;
