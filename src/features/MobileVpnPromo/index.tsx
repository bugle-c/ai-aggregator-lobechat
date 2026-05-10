'use client';

import { Flexbox } from '@lobehub/ui';
import { X } from 'lucide-react';
import { memo, useEffect, useState } from 'react';

import { useIsDark } from '@/hooks/useIsDark';

const COOKIE_NAME = 'vpn_promo_dismissed';

const readDismissed = () => {
  if (typeof document === 'undefined') return false;
  return document.cookie.split('; ').some((c) => c.startsWith(`${COOKIE_NAME}=1`));
};

const setDismissed = () => {
  document.cookie = `${COOKIE_NAME}=1; path=/; max-age=${60 * 60 * 24 * 30}; sameSite=lax`;
};

/**
 * Theme-aware dismissable VPN promo strip — used at any viewport width.
 *
 * Earlier this lived only on mobile while desktop had a separate
 * dark-glass strip with longer text. When SSR `isMobile` detection
 * mis-classified a phone the desktop strip overflowed the viewport
 * (text wrapping, content visible at top). The dark variant also
 * looked alien in light theme. Single component for both: dismissable,
 * compact, uses `useIsDark` to swap palette so it never fights the
 * active theme.
 */
const MobileVpnPromo = memo(() => {
  const [dismissed, setDismissedState] = useState(true); // start true to avoid flash before useEffect
  const isDark = useIsDark();

  useEffect(() => {
    setDismissedState(readDismissed());
  }, []);

  if (dismissed) return null;

  // Theme-aware palette. In dark mode keep the deep-glass look that
  // matched the original desktop strip; in light mode use a soft tinted
  // background with darker text so contrast stays AA on white surfaces.
  const palette = isDark
    ? {
        accent: 'rgba(34, 211, 238, 0.95)', // cyan
        background: 'rgba(8, 13, 24, 0.82)',
        border: 'rgba(148, 163, 184, 0.16)',
        muted: 'rgba(226, 232, 240, 0.78)',
        text: 'rgba(226, 232, 240, 0.92)',
      }
    : {
        accent: '#1d4ed8', // blue-700, AA on the tinted bg
        background: '#eef2ff', // indigo-50
        border: 'rgba(99, 102, 241, 0.18)',
        muted: 'rgba(30, 41, 59, 0.72)', // slate-800 @ 72%
        text: '#1e293b', // slate-800
      };

  return (
    <Flexbox
      horizontal
      align="center"
      justify="space-between"
      paddingBlock={4}
      paddingInline={12}
      style={{
        backdropFilter: isDark ? 'blur(14px)' : undefined,
        background: palette.background,
        borderBlockEnd: `1px solid ${palette.border}`,
        color: palette.text,
        fontSize: 12,
        letterSpacing: '0.01em',
        lineHeight: '24px',
        minHeight: 28,
      }}
    >
      <a
        href="https://t.me/freeip_pashavinbot"
        rel="noopener noreferrer"
        style={{ color: 'inherit', flex: 1, textDecoration: 'none' }}
        target="_blank"
      >
        <span style={{ color: palette.accent, fontWeight: 600 }}>Бесплатный VPN</span>
        <span style={{ color: palette.muted, marginInlineStart: 6 }}>
          стабильный доступ к нейросетям
        </span>
      </a>
      <button
        aria-label="Закрыть"
        onClick={() => {
          setDismissed();
          setDismissedState(true);
        }}
        style={{
          background: 'transparent',
          border: 0,
          color: palette.muted,
          cursor: 'pointer',
          padding: 4,
        }}
        type="button"
      >
        <X size={14} />
      </button>
    </Flexbox>
  );
});

MobileVpnPromo.displayName = 'VpnPromoStrip';

export default MobileVpnPromo;
