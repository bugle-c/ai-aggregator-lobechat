'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { SubscriptionActivatedModal } from '@/features/SubscriptionActivatedModal';
import { useQueryState } from '@/hooks/useQueryParam';
import { lambdaQuery } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import {
  agentIdFromPath,
  decidePaymentReturn,
  isPlansPath,
  POLL_INTERVAL_MS,
  recoveryPlansPath,
} from './paymentReturn';
import { firePaymentSuccessOnce } from './paymentSuccessGoal';

interface Activated {
  agentId: string | null;
  planName: string | null;
  planSlug: string | null;
}

/**
 * Global landing for a subscription checkout that returns to a chat route
 * (`/agent/<id>?topic=<id>&recoveryFor=<paymentId>`). Mounted once in the
 * `(main)` layout next to `RetryModal`.
 *
 * - `succeeded` → SubscriptionActivatedModal, billing / credit / model-lock
 *   queries invalidated (🔒 disappear immediately), `payment_success` goal
 *   once per payment id, `recoveryFor` stripped from the URL.
 * - `canceled` / `failed` / timeout / unknown row → redirect to
 *   `/settings/plans?recoveryFor=<id>`, whose existing handler re-polls
 *   and opens the RecoveryModal (retry / promo / support). One recovery
 *   UI, nothing duplicated here.
 *
 * `/settings/plans` itself is skipped — it keeps its own handler.
 */
const PaymentReturnHandler = memo(() => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const isLogin = useUserStore(authSelectors.isLogin);
  const utils = lambdaQuery.useUtils();

  const [recoveryForId, setRecoveryForId] = useQueryState('recoveryFor', {
    history: 'replace',
  });
  const [attempts, setAttempts] = useState(0);
  const [activated, setActivated] = useState<Activated | null>(null);
  // Terminal outcomes must fire exactly once per payment id even though the
  // effect re-runs for a few render cycles while the URL param is cleared.
  const handledRef = useRef<string | null>(null);

  const active = !!(isLogin && recoveryForId && !isPlansPath(pathname));

  const {
    data: payment,
    dataUpdatedAt,
    errorUpdatedAt,
  } = lambdaQuery.subscription.getPaymentStatus.useQuery(
    { id: recoveryForId || '' },
    {
      enabled: active,
      // YooKassa redirects before our webhook lands — poll a few seconds.
      refetchInterval: active ? POLL_INTERVAL_MS : false,
      retry: false,
    },
  );

  // Count completed fetches (not renders): the row's identity can stay
  // stable between polls, so `payment` alone would never advance the clock.
  // Errored fetches count too, so a 500 on getPaymentStatus runs out the
  // same budget instead of polling forever.
  const lastFetchAt = Math.max(dataUpdatedAt || 0, errorUpdatedAt || 0);
  useEffect(() => {
    if (!active || !lastFetchAt) return;
    setAttempts((n) => n + 1);
  }, [active, lastFetchAt]);

  // NOTE: `utils` is intentionally not in the deps — each `utils.x.y` access
  // yields a fresh proxy and would re-fire the effect every render.
  useEffect(() => {
    if (!active || !recoveryForId) return;
    if (handledRef.current === recoveryForId) return;

    const decision = decidePaymentReturn({
      attempts,
      status: dataUpdatedAt ? (payment?.status ?? null) : undefined,
    });
    // A pure-error run reaches here with status undefined and attempts
    // exhausted → 'timeout' → plans page, same as an abandoned checkout.
    if (decision.kind === 'poll') return;

    handledRef.current = recoveryForId;

    if (decision.kind === 'succeeded') {
      firePaymentSuccessOnce(recoveryForId, 'subscribe');
      void utils.subscription.getBillingState.invalidate();
      void utils.spend.invalidate();
      setActivated({
        agentId: agentIdFromPath(pathname),
        planName: payment?.planName ?? null,
        planSlug: payment?.planSlug ?? null,
      });
      setRecoveryForId(null);
      return;
    }

    // recover: let the plans page run its recovery flow (it also fires the
    // `payment_failed` goal — not duplicated here).
    navigate(recoveryPlansPath(recoveryForId), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    active,
    recoveryForId,
    attempts,
    dataUpdatedAt,
    payment,
    pathname,
    navigate,
    setRecoveryForId,
  ]);

  if (!activated) return null;

  return (
    <SubscriptionActivatedModal
      open
      agentId={activated.agentId}
      planName={activated.planName}
      planSlug={activated.planSlug}
      onClose={() => setActivated(null)}
    />
  );
});

PaymentReturnHandler.displayName = 'PaymentReturnHandler';

export default PaymentReturnHandler;
