'use client';

import { memo, useEffect, useRef, useState } from 'react';

import { useQueryState } from '@/hooks/useQueryParam';
import { lambdaQuery } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import { decidePaymentReturn, POLL_INTERVAL_MS } from './paymentReturn';
import { firePaymentSuccessOnce } from './paymentSuccessGoal';

/**
 * Global landing for a TOP-UP checkout returning from YooKassa.
 *
 * `topUp.createPayment` sends the payer back to `?payment=success`
 * (`/settings/billing`, or the chat path the contextual paywall was
 * opened from) plus `topUpFor=<paymentId>`. `payment=success` is a
 * static marker YooKassa hits on BOTH the paid and the abandoned path,
 * so it is never trusted on its own: we look the row up server-side via
 * the same `getPaymentStatus` query + `decidePaymentReturn` state
 * machine the subscription handler uses, and only a real `succeeded`
 * fires `payment_success { kind: 'topup' }`.
 *
 * Failures need no UI here — `RetryModal` already polls
 * `topUp.getRecentFailure` and owns the top-up recovery flow. We just
 * drop `topUpFor` so the poll stops.
 *
 * Deliberately inert when `recoveryFor` is also present: that return
 * belongs to `PaymentReturnHandler` (subscriptions), and the shared
 * per-payment-id guard in `firePaymentSuccessOnce` makes a double-fire
 * impossible even if both ever land on the same URL.
 */
const TopUpReturnHandler = memo(() => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const utils = lambdaQuery.useUtils();

  const [topUpForId, setTopUpForId] = useQueryState('topUpFor', { history: 'replace' });
  const [recoveryForId] = useQueryState('recoveryFor', { history: 'replace' });
  const [attempts, setAttempts] = useState(0);
  // Terminal outcomes must run exactly once per payment id even though the
  // effect re-runs for a few render cycles while the URL param is cleared.
  const handledRef = useRef<string | null>(null);

  const active = !!(isLogin && topUpForId && !recoveryForId);

  const {
    data: payment,
    dataUpdatedAt,
    errorUpdatedAt,
  } = lambdaQuery.subscription.getPaymentStatus.useQuery(
    { id: topUpForId || '' },
    {
      enabled: active,
      // YooKassa redirects before our webhook lands — poll a few seconds.
      refetchInterval: active ? POLL_INTERVAL_MS : false,
      retry: false,
    },
  );

  // Count completed fetches (not renders) — see PaymentReturnHandler.
  const lastFetchAt = Math.max(dataUpdatedAt || 0, errorUpdatedAt || 0);
  useEffect(() => {
    if (!active || !lastFetchAt) return;
    setAttempts((n) => n + 1);
  }, [active, lastFetchAt]);

  // NOTE: `utils` is intentionally not in the deps — each `utils.x.y` access
  // yields a fresh proxy and would re-fire the effect every render.
  useEffect(() => {
    if (!active || !topUpForId) return;
    if (handledRef.current === topUpForId) return;

    const decision = decidePaymentReturn({
      attempts,
      status: dataUpdatedAt ? (payment?.status ?? null) : undefined,
    });
    if (decision.kind === 'poll') return;

    handledRef.current = topUpForId;

    if (decision.kind === 'succeeded') {
      firePaymentSuccessOnce(topUpForId, 'topup');
      void utils.subscription.getBillingState.invalidate();
      // The credits the user just bought must show up immediately, not
      // after the credit query's staleTime.
      void utils.spend.invalidate();
    }

    // Both outcomes: drop the param so the poll stops. `payment=success`
    // is left alone — /settings/billing renders its success alert from it.
    setTopUpForId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, topUpForId, attempts, dataUpdatedAt, payment, setTopUpForId]);

  return null;
});

TopUpReturnHandler.displayName = 'TopUpReturnHandler';

export default TopUpReturnHandler;
