'use client';

import { message } from 'antd';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { lambdaQuery } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

/**
 * If the user lands on the app with ?tg_linked=1 in the URL, call the
 * idempotent claim mutation, toast on success, scrub the param.
 *
 * Idempotent on the server side — the mutation no-ops if already
 * claimed. We additionally use a ref to ensure the effect runs at
 * most once per mount (React strict-mode double-invoke safety).
 *
 * Gated on `isLogin` so we never fire the mutation for anonymous
 * visitors (would 401-loop). Effectively no-op until the auth state
 * resolves to logged-in.
 */
export function useClaimOnReturn() {
  const router = useRouter();
  const params = useSearchParams();
  const isLogin = useUserStore(authSelectors.isLogin);
  const ran = useRef(false);
  const claim = lambdaQuery.subscription.claimTgLinkBonus.useMutation();
  const utils = lambdaQuery.useUtils();

  useEffect(() => {
    if (ran.current) return;
    if (!isLogin) return;
    if (params.get('tg_linked') !== '1') return;
    ran.current = true;

    claim.mutate(undefined, {
      onSuccess: async (data) => {
        if (data.granted > 0) {
          message.success(`🎁 +${data.granted} кредитов на 30 дней!`);
          await utils.subscription.getBillingState.invalidate();
        }
        const url = new URL(window.location.href);
        url.searchParams.delete('tg_linked');
        router.replace(url.pathname + url.search);
      },
      onError: () => {
        // Quiet failure — don't surprise the user with an error toast
        // about a bonus they may or may not have known about.
        console.warn('[tg-link-bonus] claim mutation failed');
      },
    });
  }, [isLogin]); // re-evaluate when auth state resolves; ref still guards single-fire
}
