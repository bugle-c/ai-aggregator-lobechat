'use client';

import { memo, useEffect } from 'react';

import { reachGoal } from '@/business/client/analytics/ym';
import { RECURRING_PERIOD_DAYS } from '@/business/client/recurringDisclosure';

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
      {/* Recap of what was just consented to on the gate — the consent
          itself lives on ConsentGate.tsx, which is where the payment is
          authorised. */}
      {priceRub != null && priceRub > 0 && (
        <p style={{ color: '#888', fontSize: 13 }}>
          Подписка продлевается автоматически по {priceRub} ₽ каждые {RECURRING_PERIOD_DAYS} дней.
          Отменить можно в любой момент в настройках.
        </p>
      )}
    </div>
  );
});

CheckoutRedirect.displayName = 'CheckoutRedirect';

export default CheckoutRedirect;
