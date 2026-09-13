'use client';

import { Alert } from 'antd';
import { memo, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { lambdaQuery } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

/** localStorage: eventId of the expiry the user closed — one dismissal per expiry. */
const DISMISS_KEY = 'webgpt_expired_plan_banner_dismissed';
/** sessionStorage: eventId whose impression was already recorded this session. */
const IMPRESSION_KEY = 'webgpt_expired_plan_banner_seen';

const readStorage = (storage: 'localStorage' | 'sessionStorage', key: string) => {
  try {
    return window[storage].getItem(key);
  } catch {
    return null;
  }
};

const writeStorage = (storage: 'localStorage' | 'sessionStorage', key: string, value: string) => {
  try {
    window[storage].setItem(key, value);
  } catch {
    /* storage unavailable — banner simply shows again next time */
  }
};

/**
 * «Тариф «X» закончился <дата>. Продлить →» — shown at the top of the chat
 * (Light and Pro) for 14 days after a paid plan lapsed, while the user is on
 * free. Server decides eligibility (`upsell.getExpiredPlanNotice`); the
 * client only remembers the dismissal. Copy is hardcoded Russian — business
 * component, RU-only product surface (same convention as IntroOfferBanner).
 */
const ExpiredPlanBanner = memo(() => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const navigate = useNavigate();

  const { data } = lambdaQuery.upsell.getExpiredPlanNotice.useQuery(undefined, {
    enabled: isLogin,
    staleTime: 5 * 60_000,
  });
  const recordImpression = lambdaQuery.upsell.recordImpression.useMutation();
  const recordClick = lambdaQuery.upsell.recordClick.useMutation();

  // Lazy read is hydration-safe: the query has no SSR prefetch, so both the
  // server and the first client render return null regardless of this value.
  const [dismissedId, setDismissedId] = useState<string | null>(() =>
    readStorage('localStorage', DISMISS_KEY),
  );

  const eventId = data?.eventId;
  const visible = !!eventId && dismissedId !== eventId;

  useEffect(() => {
    if (!visible || !eventId) return;
    if (readStorage('sessionStorage', IMPRESSION_KEY) === eventId) return;
    writeStorage('sessionStorage', IMPRESSION_KEY, eventId);
    recordImpression.mutate({ source: 'expired_banner' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, eventId]);

  if (!visible || !data) return null;

  const dateStr = new Date(data.expiredAt).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
  });

  const dismiss = () => {
    writeStorage('localStorage', DISMISS_KEY, eventId!);
    setDismissedId(eventId!);
  };

  const renew = () => {
    recordClick.mutate({ source: 'expired_banner' });
    navigate('/settings/plans?utm_source=expired_banner');
  };

  return (
    <Alert
      closable
      showIcon={false}
      style={{ borderRadius: 8, margin: '8px 12px 0' }}
      type="warning"
      message={
        <span>
          Тариф «{data.planName}» закончился {dateStr}.{' '}
          <a style={{ fontWeight: 500 }} onClick={renew}>
            Продлить →
          </a>
        </span>
      }
      onClose={dismiss}
    />
  );
});

ExpiredPlanBanner.displayName = 'ExpiredPlanBanner';

export default ExpiredPlanBanner;
