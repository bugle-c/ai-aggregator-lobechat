'use client';

import { type ReactNode } from 'react';

import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import AuthGuardOverlay from './AuthGuardOverlay';

export default function AuthGuardWrapper({ children }: { children: ReactNode }) {
  const isLogin = useUserStore(authSelectors.isLogin);
  const isLoaded = useUserStore((s) => s.isLoaded);

  // Only show the registration overlay when we've definitively confirmed
  // the user is NOT signed in (session check finished, returned no user).
  // Before isLoaded flips true we have no information, so default to
  // "trust the user, show the app". Without this guard the modal would
  // flash on every tab refocus while Better Auth's useSession re-fetches.
  // Pair with UserUpdater which preserves previous isSignedIn during
  // re-fetches (those two layers together guarantee no flash).
  const showOverlay = isLoaded && !isLogin;
  const blur = showOverlay;

  return (
    <>
      {/* width:100% + display:flex column is critical — the original wrapper
          only set minHeight:100vh and let width auto-size to content. Inside
          the LobeChat layout that meant the horizontal mainContainer (NavPanel
          + DesktopLayoutContainer + drag handle) shrunk to 330px (= sidebar
          width only), leaving DesktopLayoutContainer at 0×928. From the user's
          POV the chat area was a blank white panel after login. */}
      <div
        style={{
          display: 'flex',
          filter: blur ? 'blur(3px)' : undefined,
          flexDirection: 'column',
          minHeight: '100vh',
          pointerEvents: blur ? 'none' : undefined,
          transition: 'filter 200ms ease',
          width: '100%',
        }}
      >
        {children}
      </div>
      {showOverlay && <AuthGuardOverlay />}
    </>
  );
}
