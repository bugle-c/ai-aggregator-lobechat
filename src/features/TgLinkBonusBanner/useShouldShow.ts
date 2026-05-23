'use client';

import { useEffect, useState } from 'react';

import { lambdaQuery } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

const DISMISS_KEY = 'tg_link_banner_dismissed_until';

/**
 * Returns true iff the user has no TG link AND no claim stamp AND
 * hasn't dismissed within the last 7 days.
 *
 * Gated on `isLogin` — without this gate the tRPC query 401-loops for
 * anonymous visitors landing from the marketing site, causing a
 * sidebar-flicker / "register first" toast cascade. See:
 * https://ask.gptweb.ru/trpc/lambda/subscription.getBillingState ... 401
 */
export function useShouldShow(): boolean {
  const isLogin = useUserStore(authSelectors.isLogin);

  const { data } = lambdaQuery.subscription.getBillingState.useQuery(undefined, {
    enabled: isLogin,
    retry: false,
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

  if (!isLogin) return false;
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
