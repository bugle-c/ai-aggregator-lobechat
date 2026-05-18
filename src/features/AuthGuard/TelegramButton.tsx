'use client';

import { useState } from 'react';

import { signIn } from '@/libs/better-auth/auth-client';

interface Props {
  mode: 'signin' | 'signup';
}

/**
 * Telegram OAuth — progressive enhancement.
 *
 * Rendered as `<a href>` so a click triggers OAuth flow even before
 * React hydrates. See YandexButton.tsx for the full rationale. Telegram
 * uses Better Auth's genericOAuth provider whose authorize endpoint is
 * a custom bot deep-link + Redis poll route in this codebase
 * (/api/auth/telegram/authorize). signInWithOAuth2 returns the URL to
 * that endpoint, the server forwards state cookies, then 302's.
 *
 * Ref: https://better-auth.com/docs/plugins/generic-oauth
 */
export default function TelegramButton({ mode }: Props) {
  const [loading, setLoading] = useState(false);

  const href = '/api/auth/oauth-start?provider=telegram&callbackURL=%2F';

  async function onClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    setLoading(true);
    try {
      await signIn.oauth2({
        callbackURL: '/',
        providerId: 'telegram',
      });
    } catch (err) {
      console.error('[telegram-signin]', err);
      window.location.href = href;
    }
  }

  return (
    <a
      href={href}
      style={{
        alignItems: 'center',
        background: '#0088cc',
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
        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.6 0 12 0zm5.6 8.3c-.2 1.9-1 6.5-1.4 8.7-.2.9-.5 1.2-.9 1.3-.8.1-1.4-.5-2.1-1l-3.2-2.1-1.6 1.4c-.2.2-.4.4-.7.4l.3-3.6 6.4-5.8c.3-.2-.1-.4-.4-.2l-7.9 5-3.4-1c-.7-.2-.7-.7.2-1l13.4-5.2c.6-.2 1.1.1 1 .7z" />
      </svg>
      {mode === 'signin' ? 'Войти через Telegram' : 'Регистрация через Telegram'}
    </a>
  );
}
