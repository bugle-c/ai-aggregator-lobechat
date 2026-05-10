'use client';

import { useCallback } from 'react';

import { lambdaQuery } from '@/libs/trpc/client';

export type UpsellSource =
  | 'plan_limit_chat'
  | 'locked_model'
  | 'balance_nudge'
  | 'home_pill'
  | 'welcome_email';

/**
 * Fire-and-forget tracking for upsell impression + click events.
 *
 * Both calls go through the lambda tRPC `upsell` router, which writes a
 * row to `upsell_impressions` / `upsell_clicks`. The admin
 * /finance/pricing-experiments page joins these against
 * billing_payments to compute the funnel per source.
 *
 * Failures are swallowed — analytics must never break user-visible flows.
 */
// No-op — analytics failures must not surface to the user. TanStack
// Query toasts errors by default, so we provide an explicit handler.
const swallow = () => {};

export const useTrackUpsell = () => {
  const recordImpression = lambdaQuery.upsell.recordImpression.useMutation({ onError: swallow });
  const recordClick = lambdaQuery.upsell.recordClick.useMutation({ onError: swallow });

  const impression = useCallback(
    (source: UpsellSource, opts?: { modelBlocked?: string; planOffered?: string }) => {
      recordImpression.mutate({
        modelBlocked: opts?.modelBlocked,
        planOffered: opts?.planOffered,
        source,
      });
    },
    [recordImpression],
  );

  const click = useCallback(
    (source: UpsellSource, opts?: { targetPlan?: string }) => {
      recordClick.mutate({ source, targetPlan: opts?.targetPlan });
    },
    [recordClick],
  );

  return { click, impression };
};
