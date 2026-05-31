'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'mobile-shell-v2';

/**
 * Kill-switch for the new mobile flex-shell layout. See
 * docs/superpowers/specs/2026-06-01-mobile-shell-design.md.
 *
 * Resolution order:
 *   1. URL query `?mobile-shell=on` or `?mobile-shell=off` — highest
 *      priority, persisted to localStorage so subsequent visits keep
 *      the same choice.
 *   2. localStorage `mobile-shell-v2` — survives across sessions.
 *   3. Default `true` — new users get the new shell.
 *
 * Defaults to `true` on the server / first render to keep SSR markup
 * stable; flips to the persisted/queried value once the client effect
 * runs. If we ever start serving the desktop layout to mobile crawlers
 * we'd reconsider, but for now SSR ≠ user agent targeting.
 */
export const useMobileShellFlag = (): boolean => {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    const q = params.get('mobile-shell');
    if (q === 'on' || q === 'off') {
      // Best-effort persist — Safari private mode / quota exceeded throw.
      // The user gets their URL-requested value either way; we only lose
      // the cross-session memory.
      try {
        window.localStorage.setItem(STORAGE_KEY, q);
      } catch {
        // ignore — non-fatal, kill-switch still works for this session
      }
      setEnabled(q === 'on');
      return;
    }

    // Same try-guard for getItem. If storage is hard-blocked, we fall
    // back to the default (`true`) without flipping state.
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // ignore — keep default
    }
    // Only the literal 'off' disables; anything else (including null
    // and garbage) keeps the default-on.
    setEnabled(stored !== 'off');
  }, []);

  return enabled;
};
