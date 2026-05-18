import { randomBytes } from 'node:crypto';

import { type NextRequest, NextResponse } from 'next/server';

import { authEnv } from '@/envs/auth';
import {
  CODE_TTL_SECONDS,
  getRedis,
  REDIS_KEY_PREFIX,
} from '@/libs/better-auth/sso/providers/telegram';

/**
 * GET: Serve page with Telegram bot deep link and polling.
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

  // Generate auth code and store as pending in Redis
  const code = randomBytes(8).toString('hex'); // 16 hex chars
  const redis = await getRedis();
  await redis.set(`${REDIS_KEY_PREFIX}${code}`, JSON.stringify({ status: 'pending' }), {
    ex: CODE_TTL_SECONDS,
  });

  const safeJson = (v: string) =>
    JSON.stringify(v).replaceAll('</', '<\\/').replaceAll('<!--', '<\\!--');

  const deepLink = `https://t.me/${botUsername}?start=auth_${code}`;

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
      max-width: 400px;
    }
    h2 {
      margin-bottom: 0.5rem;
      font-weight: 600;
      font-size: 1.25rem;
    }
    .subtitle {
      margin-bottom: 1.5rem;
      color: #888;
      font-size: 0.875rem;
      line-height: 1.4;
    }
    .tg-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 1.5rem;
      background: #2AABEE;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 500;
      cursor: pointer;
      text-decoration: none;
      transition: background 0.2s;
    }
    .tg-btn:hover { background: #229ED9; }
    .status {
      margin-top: 1.5rem;
      font-size: 0.875rem;
      color: #888;
    }
    .status.success { color: #4ade80; }
    .status.error { color: #f87171; }
    .spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid #555;
      border-top-color: #e5e5e5;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      vertical-align: middle;
      margin-right: 6px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <h2>Вход через Telegram</h2>
    <p class="subtitle">
      Нажмите кнопку, подтвердите вход в Telegram и вернитесь сюда — мы автоматически вас впустим.
    </p>
    <a class="tg-btn" href="${deepLink}" id="tgBtn">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.19-.04-.27-.02-.12.03-1.97 1.25-5.56 3.69-.53.36-1.01.54-1.43.53-.47-.01-1.38-.27-2.05-.49-.83-.27-1.49-.42-1.43-.88.03-.24.37-.49 1.02-.74 3.99-1.73 6.65-2.87 7.97-3.44 3.8-1.58 4.59-1.86 5.1-1.87.11 0 .37.03.54.17.14.12.18.28.2.45-.01.06.01.24 0 .37z"/>
      </svg>
      Открыть Telegram
    </a>
    <div class="status" id="status">
      <span class="spinner"></span> Ожидание подтверждения...
    </div>
    <script>
      (function() {
        var code = ${safeJson(code)};
        var state = ${safeJson(state)};
        var redirectUri = ${safeJson(redirectUri)};
        var pollUrl = '/api/auth/telegram/poll?code=' + encodeURIComponent(code);
        var stopped = false;

        function poll() {
          if (stopped) return;
          fetch(pollUrl)
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (data.status === 'confirmed') {
                stopped = true;
                document.getElementById('status').className = 'status success';
                document.getElementById('status').textContent = '\\u2713 Подтверждено! Перенаправление...';
                // Redirect to Better Auth genericOAuth callback
                var url = new URL(redirectUri);
                url.searchParams.set('code', code);
                url.searchParams.set('state', state);
                window.location.href = url.toString();
              } else if (data.status === 'expired') {
                stopped = true;
                document.getElementById('status').className = 'status error';
                document.getElementById('status').textContent = 'Код истёк. Обновите страницу.';
              } else {
                setTimeout(poll, 2000);
              }
            })
            .catch(function() {
              setTimeout(poll, 3000);
            });
        }

        // Start polling after a short delay
        setTimeout(poll, 1000);

        // Re-trigger an immediate poll whenever the tab regains focus.
        // Without target="_blank", clicking "Open Telegram" navigates
        // the same tab away; the user comes back via app handoff or
        // browser "back". Both restore this page from bfcache with
        // timers frozen, so the next poll might be ~2s away. Force one
        // right now to minimize the wait.
        function pulse() { if (!stopped) poll(); }
        document.addEventListener('visibilitychange', function() {
          if (!document.hidden) pulse();
        });
        window.addEventListener('pageshow', function(e) {
          if (e.persisted) pulse();
        });
        window.addEventListener('focus', pulse);
      })();
    </script>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
};
