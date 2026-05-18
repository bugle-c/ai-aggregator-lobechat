'use client';

import Link from 'next/link';

interface Props {
  mode: 'signin' | 'signup';
}

// Upstream lobechat Telegram SSO renders a custom authorize page
// (/api/auth/telegram/authorize) with a deep-link to @gptwebrubot and
// polling. Triggering Better Auth's social sign-in takes the user there.
export default function TelegramButton({ mode }: Props) {
  return (
    <Link
      href="/api/auth/sign-in/social?provider=telegram"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        height: 46,
        padding: '0 16px',
        borderRadius: 10,
        background: '#0088cc',
        color: '#fff',
        fontWeight: 500,
        fontSize: 14,
        textDecoration: 'none',
      }}
    >
      <svg aria-hidden="true" fill="currentColor" height="20" viewBox="0 0 24 24" width="20">
        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.6 0 12 0zm5.6 8.3c-.2 1.9-1 6.5-1.4 8.7-.2.9-.5 1.2-.9 1.3-.8.1-1.4-.5-2.1-1l-3.2-2.1-1.6 1.4c-.2.2-.4.4-.7.4l.3-3.6 6.4-5.8c.3-.2-.1-.4-.4-.2l-7.9 5-3.4-1c-.7-.2-.7-.7.2-1l13.4-5.2c.6-.2 1.1.1 1 .7z" />
      </svg>
      {mode === 'signin' ? 'Войти через Telegram' : 'Регистрация через Telegram'}
    </Link>
  );
}
