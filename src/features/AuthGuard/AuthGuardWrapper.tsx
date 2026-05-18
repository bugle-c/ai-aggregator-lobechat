'use client';

import { type ReactNode } from 'react';

import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import AuthGuardOverlay from './AuthGuardOverlay';

export default function AuthGuardWrapper({ children }: { children: ReactNode }) {
  const isLogin = useUserStore(authSelectors.isLogin);

  return (
    <>
      <div
        style={{
          filter: isLogin ? undefined : 'blur(3px)',
          minHeight: '100vh',
          pointerEvents: isLogin ? undefined : 'none',
          transition: 'filter 200ms ease',
        }}
      >
        {children}
      </div>
      {!isLogin && <AuthGuardOverlay />}
    </>
  );
}
