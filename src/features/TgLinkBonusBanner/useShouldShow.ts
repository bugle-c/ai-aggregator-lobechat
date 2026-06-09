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
// Re-enabled 2026-06-09 (was disabled 2026-05-22). Reasoning: the link
// rate sits at 3.3% (85 / 2602 users) which kills two recovery paths —
// the payment-recovery-notify cron can only DM users with a chat_id,
// and 7/7 of the last 14d failed checkouts had no TG link to push a
// retry to. The earlier UX concern (bot-mediated linking confusion)
// was addressed by the post-link modal that landed 2026-05-25 with
// task #36 + the inverted-setWhere fix in task #35. The banner is the
// cheapest place to surface the +100 кр CTA across all logged-in
// non-linked users.
const BANNER_TEMPORARILY_DISABLED = false;

export function useShouldShow(): boolean {
  const isLogin = useUserStore(authSelectors.isLogin);

  const { data } = lambdaQuery.subscription.getBillingState.useQuery(undefined, {
    enabled: !BANNER_TEMPORARILY_DISABLED && isLogin,
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

  if (BANNER_TEMPORARILY_DISABLED) return false;
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
