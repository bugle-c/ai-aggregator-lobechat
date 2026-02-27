import { appEnv } from '@/envs/app';
import { authEnv } from '@/envs/auth';
import { getRedisConfig } from '@/envs/redis';
import { initializeRedis, isRedisEnabled } from '@/libs/redis';

import { type GenericProviderDefinition } from '../types';

/**
 * Telegram bot-based auth flow:
 * 1. Serve a custom authorize page with a deep link to the bot
 * 2. User opens bot, confirms auth → bot calls /api/auth/telegram/confirm
 * 3. Authorize page polls /api/auth/telegram/poll until confirmed
 * 4. Redirect to Better Auth's genericOAuth callback with the code
 * 5. Custom getToken() reads confirmed data from Redis → synthetic token
 * 6. Custom getUserInfo() extracts profile → synthetic email tg_{id}@bot.gptweb.ru
 */

export const REDIS_KEY_PREFIX = 'tg-auth:';
export const CODE_TTL_SECONDS = 300; // 5 minutes

type TelegramUserData = {
  first_name?: string;
  id: number;
  last_name?: string;
  photo_url?: string;
  status: string;
  username?: string;
};

export const getRedis = async () => {
  const redisConfig = getRedisConfig();
  if (!isRedisEnabled(redisConfig)) {
    throw new Error('[Telegram Auth] Redis is required for Telegram OAuth');
  }
  const client = await initializeRedis(redisConfig);
  if (!client) {
    throw new Error('[Telegram Auth] Failed to initialize Redis');
  }
  return client;
};

const provider: GenericProviderDefinition<{
  AUTH_TELEGRAM_BOT_TOKEN: string;
  AUTH_TELEGRAM_BOT_USERNAME: string;
}> = {
  build: (env) => {
    const botToken = env.AUTH_TELEGRAM_BOT_TOKEN;

    return {
      // Our custom authorize page with Telegram bot deep link and polling
      authorizationUrl: `${appEnv.APP_URL}/api/auth/telegram/authorize`,

      // Not used by our custom flow, but genericOAuth requires these fields
      clientId: 'telegram',
      clientSecret: botToken,

      getToken: async ({ code }) => {
        const redis = await getRedis();
        const key = `${REDIS_KEY_PREFIX}${code}`;

        // Atomic get-and-delete to prevent code reuse
        const raw = (await redis.eval(
          "local v = redis.call('GET', KEYS[1]); if v then redis.call('DEL', KEYS[1]); end; return v;",
          1,
          key,
        )) as string | null;

        if (!raw) {
          throw new Error('[Telegram Auth] Invalid or expired auth code');
        }

        const userData = JSON.parse(raw) as TelegramUserData;

        if (userData.status !== 'confirmed') {
          throw new Error('[Telegram Auth] Auth code not yet confirmed');
        }

        return {
          accessToken: `tg-${userData.id}`,
          raw: userData,
          tokenType: 'Bearer',
        };
      },

      getUserInfo: async (tokens) => {
        const data = (tokens as { raw?: TelegramUserData }).raw;
        if (!data?.id) return null;

        const tgId = String(data.id);
        const name =
          [data.first_name, data.last_name].filter(Boolean).join(' ') || data.username || tgId;

        return {
          email: `tg_${tgId}@bot.gptweb.ru`,
          emailVerified: false,
          id: tgId,
          image: data.photo_url,
          name,
        };
      },

      pkce: false,
      providerId: 'telegram',
      responseMode: 'query',
      scopes: [],
      tokenUrl: `${appEnv.APP_URL}/api/auth/telegram/authorize`,
    };
  },

  checkEnvs: () => {
    return !!(authEnv.AUTH_TELEGRAM_BOT_TOKEN && authEnv.AUTH_TELEGRAM_BOT_USERNAME)
      ? {
          AUTH_TELEGRAM_BOT_TOKEN: authEnv.AUTH_TELEGRAM_BOT_TOKEN,
          AUTH_TELEGRAM_BOT_USERNAME: authEnv.AUTH_TELEGRAM_BOT_USERNAME,
        }
      : false;
  },
  id: 'telegram',
  type: 'generic',
};

export default provider;
