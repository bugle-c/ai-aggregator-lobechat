'use client';

import { useSearchParams } from 'next/navigation';

import AuthModal from './AuthModal';

/**
 * Fixed-position backdrop with blur + AuthModal on top. Mounted from root
 * layout when user is not authenticated. Tab default is signup; ?auth=signin
 * in URL forces signin tab.
 */
export default function AuthGuardOverlay() {
  const searchParams = useSearchParams();
  const initialTab: 'signin' | 'signup' =
    searchParams.get('auth') === 'signin' ? 'signin' : 'signup';

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
