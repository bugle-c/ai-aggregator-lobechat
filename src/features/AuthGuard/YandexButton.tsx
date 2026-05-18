'use client';

import { useState } from 'react';

interface Props {
  mode: 'signin' | 'signup';
}

/**
 * Yandex OAuth via Better Auth genericOAuth plugin.
 * The genericOAuthClient's `oauth2.signIn()` action POSTs to
 * /api/auth/oauth2/sign-in (404 — the path the server registered is
 * /api/auth/sign-in/oauth2, version mismatch). Direct fetch to the
 * working endpoint, then follow the redirect URL.
 */
export default function YandexButton({ mode }: Props) {
  const [loading, setLoading] = useState(false);

  async function onClick() {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/sign-in/oauth2', {
        body: JSON.stringify({ providerId: 'yandex', callbackURL: '/' }),
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      if (!res.ok) {
        console.error('[yandex-signin] HTTP', res.status, await res.text());
        setLoading(false);
        return;
      }
      const data = (await res.json()) as { url?: string };
      if (data.url) {
        window.location.href = data.url;
      } else {
        console.error('[yandex-signin] no redirect url in response', data);
        setLoading(false);
      }
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
