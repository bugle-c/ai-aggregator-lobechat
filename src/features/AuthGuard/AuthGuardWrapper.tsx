'use client';

import { type ReactNode } from 'react';

import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import AuthGuardOverlay from './AuthGuardOverlay';

export default function AuthGuardWrapper({ children }: { children: ReactNode }) {
  const isLogin = useUserStore(authSelectors.isLogin);

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
          filter: isLogin ? undefined : 'blur(3px)',
          flexDirection: 'column',
          minHeight: '100vh',
          pointerEvents: isLogin ? undefined : 'none',
          transition: 'filter 200ms ease',
          width: '100%',
        }}
      >
        {children}
      </div>
      {!isLogin && <AuthGuardOverlay />}
    </>
  );
}
