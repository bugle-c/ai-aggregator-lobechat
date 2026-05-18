'use client';

import { useState } from 'react';

import { signIn } from '@/libs/better-auth/auth-client';

interface Props {
  mode: 'signin' | 'signup';
}

/**
 * Yandex OAuth — progressive enhancement.
 *
 * Rendered as `<a href>` so a click triggers OAuth flow even before
 * React hydrates. Cold load on slow connections takes 20-30s to hydrate
 * the LobeChat client tree (antd, i18next, Zustand, tRPC), during which
 * `onClick` would be dead. The href points to a server route that calls
 * `auth.api.signInWithOAuth2` and 302-redirects to oauth.yandex.ru,
 * forwarding Set-Cookie for the state token.
 *
 * When hydration has happened, `onClick` preventDefault's and uses the
 * in-browser `signIn.oauth2()` flow — same result, no full page reload.
 * Ref: https://better-auth.com/docs/plugins/generic-oauth
 */
export default function YandexButton({ mode }: Props) {
  const [loading, setLoading] = useState(false);

  const href = '/api/auth/oauth-start?provider=yandex&callbackURL=%2F';

  async function onClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    setLoading(true);
    try {
      await signIn.oauth2({
        callbackURL: '/',
        providerId: 'yandex',
      });
    } catch (err) {
      console.error('[yandex-signin]', err);
      // fall back to server redirect
      window.location.href = href;
    }
  }

  return (
    <a
      href={href}
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
        pointerEvents: loading ? 'none' : 'auto',
        textDecoration: 'none',
        width: '100%',
      }}
      onClick={onClick}
    >
      <svg aria-hidden="true" fill="currentColor" height="20" viewBox="0 0 24 24" width="20">
        <path d="M13.4 11.5L17 21h-3l-3.5-9.4L7 21H4l4.6-12L4 0h3l3.6 9.5L14 0h3l-3.6 11.5z" />
      </svg>
      {mode === 'signin' ? 'Войти через Яндекс' : 'Регистрация через Яндекс'}
    </a>
  );
}
