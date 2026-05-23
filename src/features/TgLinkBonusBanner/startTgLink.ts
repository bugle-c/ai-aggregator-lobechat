'use client';

import { oauth2 } from '@/libs/better-auth/auth-client';

/**
 * The server-side OAuth-start endpoint. For a logged-in user better-
 * auth will LINK the new Telegram account to the current session
 * (creating an `accounts` row that fires our linkTelegramAccount hook
 * — see src/libs/better-auth/hooks/telegram-link.ts). For an anon user
 * it signs-in/signs-up. Either way the callback returns to callbackURL.
 */
export function tgLinkHref(): string {
  const callbackPath =
    (typeof window !== 'undefined' ? window.location.pathname : '/') + '?tg_linked=1';
  return '/api/auth/oauth-start?provider=telegram&callbackURL=' + encodeURIComponent(callbackPath);
}

/**
 * Progressive-enhancement onClick. Render the CTA as `<a href={tgLinkHref()}>`
 * so Safari can do a synchronous user-gesture-driven navigation (Safari's
 * popup blocker breaks the chain on async oauth2.link()). When JS is
 * hydrated this handler hijacks the click and uses the in-browser flow.
 */
export function onTgLinkClick(e: React.MouseEvent<HTMLAnchorElement>) {
  e.preventDefault();
  const callbackURL =
    (typeof window !== 'undefined' ? window.location.pathname : '/') + '?tg_linked=1';
  oauth2.link({ providerId: 'telegram', callbackURL }).catch((err) => {
    console.error('[tg-link-bonus] oauth2.link failed, falling back to href nav', err);
    if (typeof window !== 'undefined') {
      window.location.href = tgLinkHref();
    }
  });
}
