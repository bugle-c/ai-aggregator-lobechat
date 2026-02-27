import { randomBytes } from 'node:crypto';

import { type NextRequest, NextResponse } from 'next/server';

import { appEnv } from '@/envs/app';
import { authEnv } from '@/envs/auth';
import {
  CODE_TTL_SECONDS,
  getRedis,
  REDIS_KEY_PREFIX,
  verifyTelegramAuth,
} from '@/libs/better-auth/sso/providers/telegram';

const AUTH_DATE_MAX_AGE_SECONDS = 300;

/** Escape values for safe embedding inside `<script>` tags. */
const safeJsonEmbed = (value: string) =>
  JSON.stringify(value).replaceAll('</', '<\\/').replaceAll('<!--', '<\\!--');

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
      data-telegram-login="${botUsername.replaceAll(/[&"'<>]/g, '')}"
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
          state: ${safeJsonEmbed(state)},
          redirect_uri: ${safeJsonEmbed(redirectUri)}
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

  // 0. Validate required parameters early (before any crypto or Redis work)
  if (!redirectUri || !state) {
    return NextResponse.json({ error: 'Missing state or redirect_uri' }, { status: 400 });
  }

  // 0b. Prevent open redirect — redirect_uri must point to our own origin
  const appOrigin = new URL(appEnv.APP_URL).origin;
  const callbackUrl = new URL(redirectUri);
  if (callbackUrl.origin !== appOrigin) {
    return NextResponse.json({ error: 'Invalid redirect_uri' }, { status: 400 });
  }

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
  await redis.set(`${REDIS_KEY_PREFIX}${code}`, JSON.stringify(telegramData), {
    ex: CODE_TTL_SECONDS,
  });

  // 4. Redirect to Better Auth's genericOAuth callback
  callbackUrl.searchParams.set('code', code);
  callbackUrl.searchParams.set('state', state);

  return NextResponse.redirect(callbackUrl.toString(), 302);
};
