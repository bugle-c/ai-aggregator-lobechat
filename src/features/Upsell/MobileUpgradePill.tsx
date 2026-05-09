'use client';

import { ChevronRight, Zap } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { useTrackUpsell } from './useTrackUpsell';

const COOKIE_NAME = 'upgrade_pill_dismissed_at';
const REACTIVATE_AFTER_DAYS = 7;

const isDismissedRecently = () => {
  if (typeof document === 'undefined') return false;
  const match = document.cookie.match(new RegExp(`${COOKIE_NAME}=(\\d+)`));
  if (!match) return false;
  const ts = Number(match[1]);
  if (!Number.isFinite(ts)) return false;
  const days = (Date.now() - ts) / 86_400_000;
  return days < REACTIVATE_AFTER_DAYS;
};

const dismissNow = () => {
  document.cookie = `${COOKIE_NAME}=${Date.now()}; path=/; max-age=${
    60 * 60 * 24 * REACTIVATE_AFTER_DAYS
  }; sameSite=lax`;
};

interface Props {
  /**
   * Caller computes this from billing state — typically:
   * `plan_id === 1 && tokens_used_month > total * 0.5`. Keeps the pill
   * out of the way of paid users and free users who haven't yet burned
   * through half their quota.
   */
  shouldRender: boolean;
}

/**
 * Persistent upgrade pill rendered on the mobile home screen above the
 * input area. Free users who have used >50% of their monthly credits
 * get a one-tap path to /settings/plans. Cookie remembers
 * dismissal for 7 days; after that the pill comes back.
 */
const MobileUpgradePill = memo<Props>(({ shouldRender }) => {
  // Start dismissed so we don't briefly flash the pill before useEffect
  // reads the cookie. It un-dismisses itself on first effect tick.
  const [dismissed, setDismissed] = useState(true);
  const { click, impression } = useTrackUpsell();

  useEffect(() => {
    setDismissed(isDismissedRecently());
  }, []);

  const visible = shouldRender && !dismissed;
  useEffect(() => {
    if (visible) impression('home_pill');
  }, [visible, impression]);

  if (!visible) return null;

  return (
    <Link
      onClick={() => {
        click('home_pill');
        dismissNow();
        setDismissed(true);
      }}
      style={{
        alignItems: 'center',
        background: 'linear-gradient(90deg, #6d28d9 0%, #2563eb 100%)',
        borderRadius: 12,
        color: '#fff',
        display: 'flex',
        fontSize: 14,
        fontWeight: 600,
        gap: 8,
        marginInline: 16,
        padding: '10px 14px',
        textDecoration: 'none',
      }}
      to="/settings/plans?utm_source=home_pill"
    >
      <Zap size={16} />
      <span style={{ flex: 1 }}>Перейди на Pro — больше моделей, без лимитов</span>
      <ChevronRight size={16} />
    </Link>
  );
});

MobileUpgradePill.displayName = 'MobileUpgradePill';

export default MobileUpgradePill;
