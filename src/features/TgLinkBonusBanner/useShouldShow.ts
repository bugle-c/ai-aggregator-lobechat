'use client';

import { useEffect, useState } from 'react';

import { lambdaQuery } from '@/libs/trpc/client';

const DISMISS_KEY = 'tg_link_banner_dismissed_until';

/**
 * Returns true iff the user has no TG link AND no claim stamp AND
 * hasn't dismissed within the last 7 days.
 */
export function useShouldShow(): boolean {
  const { data } = lambdaQuery.subscription.getBillingState.useQuery(undefined, {
    staleTime: 60_000,
  });

  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return;
    const until = Number(raw);
    if (Number.isFinite(until) && until > Date.now()) setDismissed(true);
  }, []);

  if (dismissed) return false;
  if (!data) return false;
  if (data.tgBotChatId) return false;
  if (data.tgBonusClaimedAt) return false;
  return true;
}

/** Persist dismissal for 7 days. */
export function dismissBanner() {
  if (typeof window === 'undefined') return;
  localStorage.setItem(DISMISS_KEY, String(Date.now() + 7 * 86_400_000));
}
