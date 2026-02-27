import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { appEnv } from '@/envs/app';
import { authEnv } from '@/envs/auth';
import { getRedisConfig } from '@/envs/redis';
import { initializeRedis, isRedisEnabled } from '@/libs/redis';

import { type GenericProviderDefinition } from '../types';

/**
 * Telegram Login Widget returns signed user data, not standard OAuth2 codes.
 * We bridge this gap by:
 * 1. Serving a custom authorize page with the Telegram Login Widget
 * 2. Verifying HMAC-SHA256 of the auth data using bot token
 * 3. Storing verified data in Redis as a one-time auth code
 * 4. Redirecting to Better Auth's genericOAuth callback with the code
 * 5. Custom getToken() reads the code from Redis → synthetic token
 * 6. Custom getUserInfo() extracts profile → synthetic email tg_{id}@bot.gptweb.ru
 */

export const REDIS_KEY_PREFIX = 'tg-auth:';
export const CODE_TTL_SECONDS = 300; // 5 minutes

type TelegramUserData = {
  auth_date: number;
  first_name?: string;
  hash: string;
  id: number;
  last_name?: string;
  photo_url?: string;
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

/**
 * Verify Telegram auth data HMAC-SHA256 signature.
 * https://core.telegram.org/widgets/login#checking-authorization
 */
export const verifyTelegramAuth = (data: Record<string, string>, botToken: string): boolean => {
  const { hash, ...rest } = data;
  if (!hash) return false;

  // 1. Build data-check-string: key=value pairs sorted alphabetically, joined with \n
  const checkString = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${rest[key]}`)
    .join('\n');

  // 2. Secret key = SHA256(bot_token)
  const secretKey = createHash('sha256').update(botToken).digest();

  // 3. Compute HMAC-SHA256(secret_key, data_check_string)
  const hmac = createHmac('sha256', secretKey).update(checkString).digest('hex');

  const hmacBuf = Buffer.from(hmac, 'hex');
  const hashBuf = Buffer.from(hash, 'hex');
  if (hmacBuf.length !== hashBuf.length) return false;
  return timingSafeEqual(hmacBuf, hashBuf);
};

const provider: GenericProviderDefinition<{
  AUTH_TELEGRAM_BOT_TOKEN: string;
  AUTH_TELEGRAM_BOT_USERNAME: string;
}> = {
  build: (env) => {
    const botToken = env.AUTH_TELEGRAM_BOT_TOKEN;

    return {
      // Our custom authorize page that renders the Telegram Login Widget
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
