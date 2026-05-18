'use client';

import { Suspense, useEffect, useState } from 'react';

import AuthModal from './AuthModal';

/**
 * Fixed-position backdrop with blur + AuthModal on top. Mounted from root
 * layout when user is not authenticated. Tab default is signup; ?auth=signin
 * in URL forces signin tab.
 *
 * Reads `?auth=` from `window.location.search` once on mount instead of
 * `useSearchParams()` — the hook requires a Suspense boundary above the
 * client tree, and our root layout mounts this wrapper outside any Suspense,
 * which caused the overlay to never hydrate (HTML stuck on BrandTextLoading).
 */
function AuthGuardOverlayInner() {
  const [initialTab, setInitialTab] = useState<'signin' | 'signup'>('signup');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const value = new URLSearchParams(window.location.search).get('auth');
    if (value === 'signin') setInitialTab('signin');
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.18)',
        backdropFilter: 'blur(1px)',
        WebkitBackdropFilter: 'blur(1px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        overflowY: 'auto',
      }}
    >
      <AuthModal defaultTab={initialTab} />
    </div>
  );
}

export default function AuthGuardOverlay() {
  return (
    <Suspense fallback={null}>
      <AuthGuardOverlayInner />
    </Suspense>
  );
}
