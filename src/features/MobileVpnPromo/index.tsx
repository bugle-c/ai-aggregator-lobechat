'use client';

import { Flexbox } from '@lobehub/ui';
import { X } from 'lucide-react';
import { memo, useEffect, useState } from 'react';

const COOKIE_NAME = 'vpn_promo_dismissed';

const readDismissed = () => {
  if (typeof document === 'undefined') return false;
  return document.cookie.split('; ').some((c) => c.startsWith(`${COOKIE_NAME}=1`));
};

const setDismissed = () => {
  document.cookie = `${COOKIE_NAME}=1; path=/; max-age=${60 * 60 * 24 * 30}; sameSite=lax`;
};

/**
 * Compact dismissable VPN promo strip for mobile.
 *
 * The desktop `VpnPromoStrip` overlaps the mobile header (visible bug in
 * the screenshot taken during the redesign brainstorm). Mobile gets this
 * compact version rendered below the header instead. One-time dismiss is
 * stored in a cookie for 30 days.
 */
const MobileVpnPromo = memo(() => {
  const [dismissed, setDismissedState] = useState(true); // start true to avoid flash before useEffect

  useEffect(() => {
    setDismissedState(readDismissed());
  }, []);

  if (dismissed) return null;

  return (
    <Flexbox
      horizontal
      align="center"
      justify="space-between"
      paddingBlock={4}
      paddingInline={12}
      style={{
        // Match the desktop VpnPromoStrip aesthetic — dark glass + a small
        // accent text. The bright-blue gradient looked alien on iOS where
        // the rest of the chrome is muted.
        backdropFilter: 'blur(14px)',
        background: 'rgba(8, 13, 24, 0.82)',
        borderBlockEnd: '1px solid rgba(148, 163, 184, 0.16)',
        color: 'rgba(226, 232, 240, 0.86)',
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
        <span style={{ color: 'rgba(34, 211, 238, 0.95)', fontWeight: 600 }}>Бесплатный VPN</span>
        <span style={{ marginInlineStart: 6, opacity: 0.78 }}>стабильный доступ к нейросетям</span>
      </a>
      <button
        aria-label="Закрыть"
        type="button"
        style={{
          background: 'transparent',
          border: 0,
          color: 'rgba(226, 232, 240, 0.7)',
          cursor: 'pointer',
          padding: 4,
        }}
        onClick={() => {
          setDismissed();
          setDismissedState(true);
        }}
      >
        <X size={14} />
      </button>
    </Flexbox>
  );
});

MobileVpnPromo.displayName = 'MobileVpnPromo';

export default MobileVpnPromo;
