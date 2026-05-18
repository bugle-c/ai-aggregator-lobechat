import { authEnv } from '@/envs/auth';

import { type GenericProviderDefinition } from '../types';

/**
 * Yandex OAuth 2.0 provider.
 * Generic OAuth — Better Auth has no built-in Yandex.
 * Docs: https://yandex.ru/dev/id/doc/ru/codes/code-url
 */
const provider: GenericProviderDefinition<{
  AUTH_YANDEX_ID: string;
  AUTH_YANDEX_SECRET: string;
}> = {
  build: (env) => {
    return {
      providerId: 'yandex',
      clientId: env.AUTH_YANDEX_ID,
      clientSecret: env.AUTH_YANDEX_SECRET,
      authorizationUrl: 'https://oauth.yandex.ru/authorize',
      tokenUrl: 'https://oauth.yandex.ru/token',
      scopes: ['login:email', 'login:info', 'login:avatar'],
      getUserInfo: async (tokens) => {
        const response = await fetch('https://login.yandex.ru/info?format=json', {
          headers: { Authorization: `OAuth ${tokens.accessToken}` },
          cache: 'no-store',
        });

        if (!response.ok) {
          return null;
        }

        const profile = (await response.json()) as {
          id: string;
          default_email?: string;
          emails?: string[];
          real_name?: string;
          display_name?: string;
          login?: string;
          default_avatar_id?: string;
        };

        const email = (profile.default_email || profile.emails?.[0] || '').toLowerCase();

        return {
          id: profile.id,
          email,
          name: profile.real_name || profile.display_name || profile.login || email,
          image: profile.default_avatar_id
            ? `https://avatars.yandex.net/get-yapic/${profile.default_avatar_id}/islands-200`
            : undefined,
          emailVerified: !!profile.default_email,
        };
      },
    };
  },

  checkEnvs: () =>
    !!(authEnv.AUTH_YANDEX_ID && authEnv.AUTH_YANDEX_SECRET)
      ? { AUTH_YANDEX_ID: authEnv.AUTH_YANDEX_ID, AUTH_YANDEX_SECRET: authEnv.AUTH_YANDEX_SECRET }
      : false,

  id: 'yandex',
  type: 'generic',
};

export default provider;
