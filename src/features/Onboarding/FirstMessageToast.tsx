'use client';

import { App } from 'antd';
import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaQuery } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

/**
 * Shows a one-shot toast after the user's first successful message.
 *
 * Detection: we poll `spend.getCreditState` (already used elsewhere) at a
 * modest cadence and treat the transition `creditsUsed: 0 -> > 0` as
 * "first message landed". Combined with the onboarding flag this fires at
 * most once per user, even across reloads.
 */
const FirstMessageToast = memo(() => {
  const { t } = useTranslation('onboarding');
  const { notification } = App.useApp();
  const isLogin = useUserStore(authSelectors.isLogin);
  const previousUsedRef = useRef<number | null>(null);
  const firedRef = useRef(false);

  const { data: onboarding } = lambdaQuery.userOnboarding.getOnboardingState.useQuery(undefined, {
    enabled: isLogin,
    staleTime: 60_000,
  });

  const { data: credit } = lambdaQuery.spend.getCreditState.useQuery(undefined, {
    enabled: isLogin && !!onboarding && !onboarding.firstToastSeen,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
  });

  const utils = lambdaQuery.useUtils();
  const markToastSeen = lambdaQuery.userOnboarding.markFirstToastSeen.useMutation({
    onSuccess: () => {
      utils.userOnboarding.getOnboardingState.invalidate();
    },
  });

  useEffect(() => {
    if (!isLogin || !onboarding || onboarding.firstToastSeen || firedRef.current) return;
    if (!credit) return;

    const used = credit.creditsUsed;
    const prev = previousUsedRef.current;

    // Initialize baseline on first read.
    if (prev === null) {
      previousUsedRef.current = used;
      return;
    }

    // Detect first transition where credits were spent.
    if (used > prev) {
      firedRef.current = true;
      const remaining = Math.max(0, credit.totalAvailable - used);
      const charged = Math.max(1, used - prev);

      notification.open({
        description: t('toast.body', {
          charged,
          remaining,
          total: credit.totalAvailable,
        }),
        duration: 6,
        message: t('toast.title'),
        placement: 'topRight',
      });

      markToastSeen.mutate();
    }

    previousUsedRef.current = used;
  }, [credit, onboarding, isLogin, notification, t, markToastSeen]);

  return null;
});

FirstMessageToast.displayName = 'OnboardingFirstMessageToast';

export default FirstMessageToast;
