'use client';

import { useState } from 'react';

import { oauth2 } from '@/libs/better-auth/auth-client';

interface Props {
  mode: 'signin' | 'signup';
}

/**
 * Yandex OAuth via Better Auth's genericOAuthClient.
 * `oauth2.signIn({ providerId })` POSTs to /api/auth/sign-in/oauth2 and
 * the server returns a 302 redirect to oauth.yandex.ru — the client
 * follows it automatically.
 */
export default function YandexButton({ mode }: Props) {
  const [loading, setLoading] = useState(false);

  async function onClick() {
    setLoading(true);
    try {
      await oauth2.signIn({
        providerId: 'yandex',
        callbackURL: '/',
      });
    } catch (e) {
      console.error('[yandex-signin]', e);
      setLoading(false);
    }
  }

  return (
    <button
      disabled={loading}
      type="button"
      style={{
        alignItems: 'center',
        background: '#FC3F1D',
        border: 'none',
        borderRadius: 10,
        color: '#fff',
        cursor: loading ? 'wait' : 'pointer',
        display: 'flex',
        fontSize: 14,
        fontWeight: 500,
        gap: 10,
        height: 46,
        justifyContent: 'center',
        opacity: loading ? 0.7 : 1,
        padding: '0 16px',
        textDecoration: 'none',
        width: '100%',
      }}
      onClick={onClick}
    >
      <svg aria-hidden="true" fill="currentColor" height="20" viewBox="0 0 24 24" width="20">
        <path d="M13.4 11.5L17 21h-3l-3.5-9.4L7 21H4l4.6-12L4 0h3l3.6 9.5L14 0h3l-3.6 11.5z" />
      </svg>
      {mode === 'signin' ? 'Войти через Яндекс' : 'Регистрация через Яндекс'}
    </button>
  );
}
