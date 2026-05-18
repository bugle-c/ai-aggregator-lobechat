import { authEnv } from '@/envs/auth';

import { type GenericProviderDefinition } from '../types';

/**
 * Telegram OIDC (modern flow).
 *
 * Standard OAuth 2.0 / OpenID Connect via `oauth.telegram.org` —
 * configured per bot via @BotFather (Bot Settings → Web Login →
 * OpenID Connect Login). Replaces the earlier custom bot-deep-link
 * flow that opened a new browser tab on mobile (Chrome / Yandex /
 * Safari all force a new tab for https://t.me/... links because they
 * treat them as universal links).
 *
 * The new flow is plain redirect-based OAuth — same tab throughout:
 *   1. signIn.oauth2({providerId:'telegram'}) → POST /sign-in/oauth2
 *   2. server returns redirect URL: oauth.telegram.org/auth?...
 *   3. browser navigates (same tab) to oauth.telegram.org
 *   4. Telegram authenticates via web or app handoff (their UI)
 *   5. redirect back to /api/auth/callback/telegram?code=...
 *   6. Better Auth exchanges code at oauth.telegram.org/token
 *   7. ID token decoded, getUserInfo synthesizes a stable email
 *
 * Telegram OIDC discovery (https://oauth.telegram.org/.well-known/
 * openid-configuration) advertises scopes openid/profile/phone and
 * supports PKCE S256. We request openid+profile; phone is optional.
 *
 * The id_token's `sub` claim is the user's numeric Telegram ID, which
 * Better Auth stores as `account.accountId`. The existing
 * databaseHooks.account.create.after handler reads accountId and
 * calls linkTelegramAccount — that hook works unchanged.
 *
 * Setup in @BotFather (one-time, already done by Pavel):
 *   - Open BotFather as MINI APP (icon, not chat)
 *   - Bot Settings → gptwebrubot → Web Login
 *   - Add the site URL, remove it, reopen — OpenID Connect Login
 *     option unlocks (permanent, one-way)
 *   - Allowed URL:  https://ask.gptweb.ru
 *   - Redirect URL: https://ask.gptweb.ru/api/auth/callback/telegram
 *   - Copy Client ID + Client Secret (NOT bot token, NOT username)
 */

type TelegramIdTokenClaims = {
  name?: string;
  phone_number?: string;
  picture?: string;
  preferred_username?: string;
  sub: string;
};

const provider: GenericProviderDefinition<{
  AUTH_TELEGRAM_CLIENT_ID: string;
  AUTH_TELEGRAM_CLIENT_SECRET: string;
}> = {
  build: (env) => {
    return {
      clientId: env.AUTH_TELEGRAM_CLIENT_ID,
      clientSecret: env.AUTH_TELEGRAM_CLIENT_SECRET,

      // OIDC auto-discovery — Better Auth pulls authorization_endpoint,
      // token_endpoint, jwks_uri from this. Saves us from hardcoding
      // endpoints that Telegram could change.
      discoveryUrl: 'https://oauth.telegram.org/.well-known/openid-configuration',

      // Telegram's id_token has user data; no separate /userinfo
      // endpoint is advertised, so we read claims from the token.
      // Better Auth passes decoded claims via tokens.raw when available;
      // we fall back to parsing id_token manually if not.
      getUserInfo: async (tokens) => {
        const raw = tokens as {
          idToken?: string;
          raw?: TelegramIdTokenClaims;
        };
        let claims = raw.raw;

        if (!claims?.sub && raw.idToken) {
          // Decode JWT payload without verification — Better Auth has
          // already verified the signature via jwks_uri before passing
          // tokens to us. We only need the claim values here.
          try {
            const payload = raw.idToken.split('.')[1];
            const decoded = Buffer.from(payload, 'base64url').toString('utf8');
            claims = JSON.parse(decoded);
          } catch {
            // fall through — null below
          }
        }

        if (!claims?.sub) return null;

        const tgId = String(claims.sub);
        const name = claims.name || claims.preferred_username || tgId;

        return {
          // Synthetic email — Telegram OIDC doesn't expose real emails.
          // Same scheme as the previous bot-deep-link flow so existing
          // users keep matching by primary key.
          email: `tg_${tgId}@bot.gptweb.ru`,
          emailVerified: false,
          id: tgId,
          image: claims.picture,
          name,
        };
      },

      // PKCE S256 is supported (and recommended) per discovery.
      pkce: true,
      providerId: 'telegram',
      responseMode: 'query',

      // openid is mandatory; profile gives us name + picture + username.
      // We omit "phone" — adding it later if/when we want phone capture
      // will not break existing accounts since the sub remains the same.
      scopes: ['openid', 'profile'],
    };
  },

  checkEnvs: () => {
    return !!(authEnv.AUTH_TELEGRAM_CLIENT_ID && authEnv.AUTH_TELEGRAM_CLIENT_SECRET)
      ? {
          AUTH_TELEGRAM_CLIENT_ID: authEnv.AUTH_TELEGRAM_CLIENT_ID,
          AUTH_TELEGRAM_CLIENT_SECRET: authEnv.AUTH_TELEGRAM_CLIENT_SECRET,
        }
      : false;
  },
  id: 'telegram',
  type: 'generic',
};

export default provider;
