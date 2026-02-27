# Telegram Bot Auth for LobeChat — Design

## Goal

Allow users to sign in to ask.gptweb.ru via Telegram bot confirmation (not widget). User clicks deep link → bot sends confirm button → user clicks → logged in.

## Architecture

```
Site                               Bot                        Telegram
 |                                 |                           |
 | click "Войти через Telegram"    |                           |
 | → generate code                 |                           |
 | → Redis: tg-auth:{code}=pending|                           |
 | → show button:                  |                           |
 |   "Открыть Telegram"           |                           |
 |   (t.me/gptwebrubot?start=     |                           |
 |    auth_{code})                 |                           |
 | → JS polls /poll every 2s      |                           |
 |                                 |                           |
 |    user clicks deep link ------>| /start auth_{code}        |
 |                                 | → "Подтвердите вход"      |
 |                                 |   + button [Подтвердить]  |
 |                                 |                           |
 |                                 | user clicks [Подтвердить] |
 |                                 | → POST localhost:3210     |
 |                                 |   /api/auth/telegram/     |
 |                                 |   confirm {code, user}    |
 |                                 | → "✅ Вы вошли!"          |
 |                                 |                           |
 | poll → confirmed! ------------->|                           |
 | → redirect to genericOAuth     |                           |
 | → getToken(code) → Redis       |                           |
 | → getUserInfo → session         |                           |
 | → logged in ✓                  |                           |
```

## Endpoints (LobeChat)

- `GET /api/auth/telegram/authorize` — page with deep link + polling JS
- `GET /api/auth/telegram/poll?code=X` — returns `{status}` from Redis
- `POST /api/auth/telegram/confirm` — bot calls with user data (auth: bot token as Bearer)

## Bot (gptwebrubot)

- Handle `/start auth_{code}` → send confirm button
- Callback `confirm_auth:{code}` → POST to LobeChat confirm endpoint
- No new dependencies — plain HTTP fetch to localhost

## Security

- Confirm endpoint validates `AUTH_TELEGRAM_BOT_TOKEN` as Bearer token
- Codes in Redis with 5-min TTL, one-time use (atomic GETDEL in getToken)
- Deep link contains random code (16 hex chars = 8 bytes entropy)

## Account Linking

Synthetic email `tg_{telegram_id}@bot.gptweb.ru` matches bot-created accounts.
Better Auth `accountLinking: { enabled: true, allowDifferentEmails: true }` handles the rest.

## Redis Key Format

- Key: `tg-auth:{code}`
- Pending: `{"status":"pending"}`
- Confirmed: `{"status":"confirmed","id":123,"first_name":"John",...}`
- TTL: 300 seconds
