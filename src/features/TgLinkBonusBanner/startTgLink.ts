'use client';

import { oauth2 } from '@/libs/better-auth/auth-client';

/**
 * Start the TG OIDC link flow for an already-logged-in user. Telegram
 * is a generic-OAuth (non-builtin) provider, so the correct API is
 * `oauth2.link()` — `signIn.oauth2()` does sign-in not linking and
 * silently no-ops when a session already exists.
 *
 * On success Better Auth redirects to the callbackURL. We append
 * `?tg_linked=1` so `useClaimOnReturn` picks it up and toasts.
 */
export async function startTgLink() {
  const callbackURL =
    (typeof window !== 'undefined' ? window.location.pathname : '/') + '?tg_linked=1';
  try {
    await oauth2.link({ providerId: 'telegram', callbackURL });
  } catch (err) {
    console.error('[tg-link-bonus] oauth2.link failed', err);
    if (typeof window !== 'undefined') {
      window.location.href =
        '/api/auth/oauth-start?provider=telegram&callbackURL=' + encodeURIComponent(callbackURL);
    }
  }
}
