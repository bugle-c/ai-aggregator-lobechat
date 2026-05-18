'use client';

import dynamic from 'next/dynamic';
import { type ReactNode } from 'react';

import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

// Lazy-load to avoid SSR issues (uses client-only hooks + antd)
const AuthGuardOverlay = dynamic(() => import('./AuthGuardOverlay'), { ssr: false });

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
