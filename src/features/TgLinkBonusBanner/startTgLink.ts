'use client';

import { signIn } from '@/libs/better-auth/auth-client';

/**
 * Start the TG OIDC link flow. On success Better Auth redirects to the
 * callbackURL with the same origin. We append `?tg_linked=1` so
 * useClaimOnReturn picks it up and toasts.
 */
export async function startTgLink() {
  const callbackURL =
    (typeof window !== 'undefined' ? window.location.pathname : '/') + '?tg_linked=1';
  try {
    await signIn.oauth2({ providerId: 'telegram', callbackURL });
  } catch (err) {
    console.error('[tg-link-bonus] signIn.oauth2 failed', err);
    if (typeof window !== 'undefined') {
      window.location.href =
        '/api/auth/oauth-start?provider=telegram&callbackURL=' + encodeURIComponent(callbackURL);
    }
  }
}
