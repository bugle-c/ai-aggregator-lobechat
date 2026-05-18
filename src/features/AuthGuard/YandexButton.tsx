'use client';

import Link from 'next/link';

interface Props {
  mode: 'signin' | 'signup';
}

export default function YandexButton({ mode }: Props) {
  return (
    <Link
      href="/api/auth/sign-in/social?provider=yandex"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        height: 46,
        padding: '0 16px',
        borderRadius: 10,
        background: '#FC3F1D',
        color: '#fff',
        fontWeight: 500,
        fontSize: 14,
        textDecoration: 'none',
      }}
    >
      <svg aria-hidden="true" fill="currentColor" height="20" viewBox="0 0 24 24" width="20">
        <path d="M13.4 11.5L17 21h-3l-3.5-9.4L7 21H4l4.6-12L4 0h3l3.6 9.5L14 0h3l-3.6 11.5z" />
      </svg>
      {mode === 'signin' ? 'Войти через Яндекс' : 'Регистрация через Яндекс'}
    </Link>
  );
}
