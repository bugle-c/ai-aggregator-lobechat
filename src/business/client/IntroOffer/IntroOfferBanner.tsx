'use client';

import { Alert } from 'antd';
import { memo, useEffect } from 'react';

import { reachGoal } from '@/business/client/analytics/ym';
import { lambdaQuery } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

const VIEW_GOAL_SESSION_KEY = 'webgpt_intro_offer_viewed';

/**
 * 48h intro-offer banner: a user who claimed the earned-magic bonus and has
 * never paid sees «+1000 кредитов сверху» until the 48h window closes.
 * Mounted on Plans and inside CreditsExhaustedModal. Copy is intentionally
 * hardcoded Russian — business component, RU-only product surface.
 */
const IntroOfferBanner = memo(() => {
  const isLogin = useUserStore(authSelectors.isLogin);

  const { data } = lambdaQuery.userOnboarding.getIntroOfferState.useQuery(undefined, {
    enabled: isLogin,
  });

  const eligible = !!data?.eligible && !!data?.expiresAt;

  // Fire the funnel goal once per browser session, not per mount.
  useEffect(() => {
    if (!eligible) return;
    try {
      if (sessionStorage.getItem(VIEW_GOAL_SESSION_KEY) === '1') return;
      sessionStorage.setItem(VIEW_GOAL_SESSION_KEY, '1');
    } catch {
      /* storage unavailable — still fire once for this mount */
    }
    reachGoal('intro_offer_view');
  }, [eligible]);

  if (!eligible) return null;

  const expiresAt = new Date(data!.expiresAt!);
  const hoursLeft = Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 3_600_000));
  const deadline = expiresAt.toLocaleString('ru-RU', {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'long',
  });

  return (
    <Alert
      message={`🎁 Оплатите любой тариф до ${deadline} — получите +1000 кредитов сверху · осталось ${hoursLeft}ч`}
      showIcon={false}
      type="success"
    />
  );
});

IntroOfferBanner.displayName = 'IntroOfferBanner';

export default IntroOfferBanner;
