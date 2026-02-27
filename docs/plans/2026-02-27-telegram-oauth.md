# Telegram OAuth for LobeChat — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to sign in to ask.gptweb.ru via Telegram, linking to existing bot-created accounts (`tg_XXX@bot.gptweb.ru`).

**Architecture:** Telegram Login Widget served from a custom authorize endpoint. Widget popup authenticates user, JS callback POSTs signed data to server. Server verifies HMAC-SHA256, stores one-time code in Redis, redirects to Better Auth's genericOAuth callback. Custom `getToken`/`getUserInfo` in the provider complete the standard flow — session created automatically by Better Auth.

**Tech Stack:** Better Auth 1.4.6 (genericOAuth plugin), Telegram Login Widget, Redis (ioredis), HMAC-SHA256 (Node crypto)

---

## Flow Diagram

```
User clicks "Войти через Telegram"
 → signIn.oauth2({ providerId: 'telegram' })
 → Better Auth redirects to GET /api/auth/telegram/authorize?state=X&redirect_uri=Y
 → HTML page with Telegram Login Widget is served
 → User clicks widget → Telegram popup → authenticates
 → Popup closes, JS onTelegramAuth(user) called on our page
 → JS submits form POST to /api/auth/telegram/authorize
   with: Telegram user data + state + redirect_uri
 → POST handler:
   1. Verify HMAC-SHA256(SHA256(bot_token), data_check_string) == hash
   2. Check auth_date not older than 5 minutes
   3. Generate random code, store user data in Redis: tg-auth:{code} TTL 300s
   4. Redirect to redirect_uri?code={code}&state={state}
 → Better Auth genericOAuth callback at /api/auth/callback/telegram
   calls getToken({ code })
     → reads tg-auth:{code} from Redis, deletes key
     → returns synthetic token { accessToken, raw: userData }
   calls getUserInfo(tokens)
     → returns { id: tgId, email: tg_{tgId}@bot.gptweb.ru, name, image }
 → Better Auth finds user by email (bot-created) or creates new
 → Session created, user logged in
```

---

## Task 1: Add env vars to auth config

**Files:**
- Modify: `src/envs/auth.ts`

**Step 1: Add ProcessEnv declarations**

In `src/envs/auth.ts`, after the `AUTH_WECHAT_SECRET` line (line ~81), add:

```typescript
      AUTH_TELEGRAM_BOT_TOKEN?: string;
      AUTH_TELEGRAM_BOT_USERNAME?: string;
```

**Step 2: Add to createEnv server block**

After the `AUTH_WECHAT_SECRET: z.string().optional(),` line (line ~182), add:

```typescript
      AUTH_TELEGRAM_BOT_TOKEN: z.string().optional(),
      AUTH_TELEGRAM_BOT_USERNAME: z.string().optional(),
```

**Step 3: Add to runtimeEnv block**

After the `AUTH_WECHAT_SECRET: process.env.AUTH_WECHAT_SECRET,` line (line ~275), add:

```typescript
      AUTH_TELEGRAM_BOT_TOKEN: process.env.AUTH_TELEGRAM_BOT_TOKEN,
      AUTH_TELEGRAM_BOT_USERNAME: process.env.AUTH_TELEGRAM_BOT_USERNAME,
```

**Step 4: Commit**

```bash
git add src/envs/auth.ts
git commit -m "feat: add Telegram OAuth env vars to auth config"
```

---

## Task 2: Create Telegram SSO provider

**Files:**
- Create: `src/libs/better-auth/sso/providers/telegram.ts`

**Step 1: Create provider file**

```typescript
import { createHmac, createHash, randomBytes } from 'node:crypto';

import { authEnv } from '@/envs/auth';
import { appEnv } from '@/envs/app';
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

const REDIS_KEY_PREFIX = 'tg-auth:';
const CODE_TTL_SECONDS = 300; // 5 minutes

type TelegramUserData = {
  auth_date: number;
  first_name?: string;
  hash: string;
  id: number;
  last_name?: string;
  photo_url?: string;
  username?: string;
};

const getRedis = async () => {
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

  return hmac === hash;
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

      // Not used (genericOAuth requires it, but our getToken reads from Redis)
      clientId: 'telegram',
      clientSecret: botToken,

      getToken: async ({ code }) => {
        const redis = await getRedis();
        const key = `${REDIS_KEY_PREFIX}${code}`;
        const raw = await redis.get(key);

        if (!raw) {
          throw new Error('[Telegram Auth] Invalid or expired auth code');
        }

        // One-time use: delete after reading
        await redis.del(key);

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
          [data.first_name, data.last_name].filter(Boolean).join(' ') ||
          data.username ||
          tgId;

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
```

**Step 2: Commit**

```bash
git add src/libs/better-auth/sso/providers/telegram.ts
git commit -m "feat: add Telegram SSO provider with HMAC verification"
```

---

## Task 3: Create custom authorize endpoint

**Files:**
- Create: `src/app/(backend)/api/auth/telegram/authorize/route.ts`

**Step 1: Create the route handler**

This endpoint serves two purposes:
- GET: Renders HTML page with Telegram Login Widget
- POST: Receives authenticated user data from widget callback, verifies HMAC, generates Redis code, redirects to genericOAuth callback

```typescript
import { randomBytes } from 'node:crypto';

import { type NextRequest, NextResponse } from 'next/server';

import { authEnv } from '@/envs/auth';
import { getRedisConfig } from '@/envs/redis';
import { initializeRedis, isRedisEnabled } from '@/libs/redis';

import { verifyTelegramAuth } from '@/libs/better-auth/sso/providers/telegram';

const REDIS_KEY_PREFIX = 'tg-auth:';
const CODE_TTL_SECONDS = 300;
const AUTH_DATE_MAX_AGE_SECONDS = 300;

const getRedis = async () => {
  const redisConfig = getRedisConfig();
  if (!isRedisEnabled(redisConfig)) {
    throw new Error('[Telegram Auth] Redis is required');
  }
  const client = await initializeRedis(redisConfig);
  if (!client) {
    throw new Error('[Telegram Auth] Failed to initialize Redis');
  }
  return client;
};

/**
 * GET: Serve HTML page with Telegram Login Widget.
 * Better Auth redirects here with ?state=...&redirect_uri=...
 */
export const GET = async (req: NextRequest) => {
  const botUsername = authEnv.AUTH_TELEGRAM_BOT_USERNAME;
  if (!botUsername) {
    return NextResponse.json({ error: 'Telegram auth not configured' }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const state = searchParams.get('state') || '';
  const redirectUri = searchParams.get('redirect_uri') || '';

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Вход через Telegram</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: #0a0a0a;
      color: #e5e5e5;
    }
    .container {
      text-align: center;
      padding: 2rem;
    }
    h2 {
      margin-bottom: 1.5rem;
      font-weight: 500;
      font-size: 1.25rem;
    }
    .loading {
      display: none;
      margin-top: 1rem;
      color: #888;
    }
    .loading.active { display: block; }
  </style>
</head>
<body>
  <div class="container">
    <h2>Вход через Telegram</h2>
    <script async src="https://telegram.org/js/telegram-widget.js?22"
      data-telegram-login="${botUsername}"
      data-size="large"
      data-radius="8"
      data-onauth="onTelegramAuth(user)"
      data-request-access="write">
    </script>
    <div class="loading" id="loading">Авторизация...</div>
    <script>
      function onTelegramAuth(user) {
        document.getElementById('loading').classList.add('active');
        var form = document.createElement('form');
        form.method = 'POST';
        form.action = window.location.pathname;
        var fields = Object.assign({}, user, {
          state: ${JSON.stringify(state)},
          redirect_uri: ${JSON.stringify(redirectUri)}
        });
        Object.keys(fields).forEach(function(key) {
          var input = document.createElement('input');
          input.type = 'hidden';
          input.name = key;
          input.value = String(fields[key]);
          form.appendChild(input);
        });
        document.body.appendChild(form);
        form.submit();
      }
    </script>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
};

/**
 * POST: Receive Telegram auth data from widget callback.
 * Verify HMAC, store in Redis, redirect to genericOAuth callback.
 */
export const POST = async (req: NextRequest) => {
  const botToken = authEnv.AUTH_TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return NextResponse.json({ error: 'Telegram auth not configured' }, { status: 500 });
  }

  const formData = await req.formData();
  const data: Record<string, string> = {};
  formData.forEach((value, key) => {
    data[key] = String(value);
  });

  const { state, redirect_uri: redirectUri, ...telegramData } = data;

  // 1. Verify HMAC-SHA256 signature
  if (!verifyTelegramAuth(telegramData, botToken)) {
    return NextResponse.json({ error: 'Invalid Telegram auth data' }, { status: 403 });
  }

  // 2. Check auth_date not too old
  const authDate = Number(telegramData.auth_date);
  if (!authDate || Date.now() / 1000 - authDate > AUTH_DATE_MAX_AGE_SECONDS) {
    return NextResponse.json({ error: 'Telegram auth data expired' }, { status: 403 });
  }

  // 3. Generate one-time code, store in Redis
  const code = randomBytes(32).toString('hex');
  const redis = await getRedis();
  await redis.set(`${REDIS_KEY_PREFIX}${code}`, JSON.stringify(telegramData), { ex: CODE_TTL_SECONDS });

  // 4. Redirect to Better Auth's genericOAuth callback
  if (!redirectUri || !state) {
    return NextResponse.json({ error: 'Missing state or redirect_uri' }, { status: 400 });
  }

  const callbackUrl = new URL(redirectUri);
  callbackUrl.searchParams.set('code', code);
  callbackUrl.searchParams.set('state', state);

  return NextResponse.redirect(callbackUrl.toString(), 302);
};
```

**Step 2: Commit**

```bash
git add src/app/\(backend\)/api/auth/telegram/authorize/route.ts
git commit -m "feat: add Telegram authorize endpoint with widget page"
```

---

## Task 4: Register provider in SSO index

**Files:**
- Modify: `src/libs/better-auth/sso/index.ts`

**Step 1: Add import**

After line 24 (`import Wechat from './providers/wechat';`), add:

```typescript
import Telegram from './providers/telegram';
```

**Step 2: Add to providerDefinitions**

In the `providerDefinitions` array (after `Wechat,` on line 44), add:

```typescript
  Telegram,
```

**Step 3: Commit**

```bash
git add src/libs/better-auth/sso/index.ts
git commit -m "feat: register Telegram in SSO provider registry"
```

---

## Task 5: Add Telegram icon

**Files:**
- Modify: `src/components/AuthIcons.tsx`

**Step 1: Add Send import**

Change line 13 from:
```typescript
import { User } from 'lucide-react';
```
to:
```typescript
import { Send, User } from 'lucide-react';
```

**Step 2: Add icon mapping**

Add to `iconComponents` object (after `'zitadel': Zitadel.Color,`):

```typescript
  'telegram': Send,
```

**Step 3: Commit**

```bash
git add src/components/AuthIcons.tsx
git commit -m "feat: add Telegram icon to auth icons"
```

---

## Task 6: Add locale keys

**Files:**
- Modify: `src/locales/default/auth.ts`
- Modify: `locales/ru-RU/auth.json`
- Modify: `locales/en-US/auth.json`

**Step 1: Add default locale**

In `src/locales/default/auth.ts`, after the `continueWithWechat` line (line ~81), add:

```typescript
  'betterAuth.signin.continueWithTelegram': 'Sign in with Telegram',
```

**Step 2: Add Russian locale**

In `locales/ru-RU/auth.json`, after `continueWithWechat` line, add:

```json
  "betterAuth.signin.continueWithTelegram": "Войти через Telegram",
```

**Step 3: Add English locale**

In `locales/en-US/auth.json`, after `continueWithWechat` line, add:

```json
  "betterAuth.signin.continueWithTelegram": "Sign in with Telegram",
```

**Step 4: Commit**

```bash
git add src/locales/default/auth.ts locales/ru-RU/auth.json locales/en-US/auth.json
git commit -m "feat: add Telegram auth locale keys (en, ru)"
```

---

## Task 7: Build verification

**Step 1: Run build**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
bun run build
```

Expected: Build succeeds. If it fails, fix type errors or import issues.

**Step 2: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve build issues for Telegram auth"
```

---

## Task 8: Deploy — add env vars and restart

**Step 1: Add env vars to /opt/lobechat/.env**

```bash
# Add to /opt/lobechat/.env:
AUTH_TELEGRAM_BOT_TOKEN=8022195574:AAFYWvTL3wm4RQeOpZV-kuiHIq4JJBhU1Nk
AUTH_TELEGRAM_BOT_USERNAME=gptwebrubot
AUTH_SSO_PROVIDERS=telegram
```

Note: `AUTH_SSO_PROVIDERS` — if other providers are already configured, append with comma: `google,telegram`

**Step 2: Set Telegram Login Widget domain**

In Telegram @BotFather for @gptwebrubot:
```
/setdomain
→ select @gptwebrubot
→ ask.gptweb.ru
```

**Step 3: Rebuild and restart Docker**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
docker build -t lobechat-custom:latest .
cd /opt/lobechat
docker compose up -d
```

**Step 4: Verify**

1. Open `https://ask.gptweb.ru/signin`
2. "Войти через Telegram" button should appear
3. Click it → Telegram popup → authenticate → redirected to app
4. Check that user email is `tg_{id}@bot.gptweb.ru`

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/libs/better-auth/sso/providers/telegram.ts` | Generic OAuth provider: HMAC verification, getToken (Redis), getUserInfo |
| `src/app/(backend)/api/auth/telegram/authorize/route.ts` | GET: Telegram Login Widget HTML page. POST: verify + Redis code + redirect |
| `src/libs/better-auth/sso/index.ts` | Register provider in SSO registry |
| `src/envs/auth.ts` | AUTH_TELEGRAM_BOT_TOKEN, AUTH_TELEGRAM_BOT_USERNAME |
| `src/components/AuthIcons.tsx` | Telegram icon (Send from lucide-react) |
| `src/locales/default/auth.ts` | Default locale key |
| `locales/ru-RU/auth.json` | Russian locale |
| `locales/en-US/auth.json` | English locale |
| `/opt/lobechat/.env` | Production env vars |

## Security Notes

- HMAC-SHA256 verification prevents forged auth data (bot token never exposed to client)
- Auth codes in Redis with 5-minute TTL prevent replay attacks
- `auth_date` check rejects stale authentication data
- One-time code: deleted from Redis after first use in `getToken`
- `state` parameter preserved through the flow for CSRF protection (Better Auth validates it)
