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
      align="center"
      horizontal
      justify="space-between"
      paddingBlock={6}
      paddingInline={12}
      style={{
        background: 'linear-gradient(90deg, #1d4ed8 0%, #2563eb 100%)',
        color: '#fff',
        fontSize: 13,
      }}
    >
      <a
        href="https://t.me/freeip_pashavinbot"
        rel="noopener noreferrer"
        style={{ color: 'inherit', textDecoration: 'none' }}
        target="_blank"
      >
        🔓 Бесплатный VPN →
      </a>
      <button
        aria-label="Закрыть"
        onClick={() => {
          setDismissed();
          setDismissedState(true);
        }}
        style={{ background: 'transparent', border: 0, color: '#fff', cursor: 'pointer' }}
        type="button"
      >
        <X size={16} />
      </button>
    </Flexbox>
  );
});

MobileVpnPromo.displayName = 'MobileVpnPromo';

export default MobileVpnPromo;
