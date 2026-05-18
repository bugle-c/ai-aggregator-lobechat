'use client';

import { useState } from 'react';

import { oauth2 } from '@/libs/better-auth/auth-client';

interface Props {
  mode: 'signin' | 'signup';
}

/**
 * Telegram OAuth via Better Auth's genericOAuthClient.
 * Upstream lobechat registers Telegram as a generic OAuth provider whose
 * authorize endpoint is /api/auth/telegram/authorize (custom bot deep-link
 * + Redis poll page). `oauth2.signIn` initiates that flow.
 */
export default function TelegramButton({ mode }: Props) {
  const [loading, setLoading] = useState(false);

  async function onClick() {
    setLoading(true);
    try {
      await oauth2.signIn({
        providerId: 'telegram',
        callbackURL: '/',
      });
    } catch (e) {
      console.error('[telegram-signin]', e);
      setLoading(false);
    }
  }

  return (
    <button
      disabled={loading}
      type="button"
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
        textDecoration: 'none',
        width: '100%',
      }}
      onClick={onClick}
    >
      <svg aria-hidden="true" fill="currentColor" height="20" viewBox="0 0 24 24" width="20">
        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.6 0 12 0zm5.6 8.3c-.2 1.9-1 6.5-1.4 8.7-.2.9-.5 1.2-.9 1.3-.8.1-1.4-.5-2.1-1l-3.2-2.1-1.6 1.4c-.2.2-.4.4-.7.4l.3-3.6 6.4-5.8c.3-.2-.1-.4-.4-.2l-7.9 5-3.4-1c-.7-.2-.7-.7.2-1l13.4-5.2c.6-.2 1.1.1 1 .7z" />
      </svg>
      {mode === 'signin' ? 'Войти через Telegram' : 'Регистрация через Telegram'}
    </button>
  );
}
