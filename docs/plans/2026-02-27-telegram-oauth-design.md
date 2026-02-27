# Telegram OAuth for LobeChat — Design

## Goal

Allow Telegram users to log into the web version (ask.gptweb.ru) using Telegram Login Widget. Accounts created by the bot (tg_XXX@bot.gptweb.ru) should be automatically linked.

## Architecture

```
User clicks "Continue with Telegram"
  → Better Auth redirects to /api/auth/telegram/authorize
  → Page renders Telegram Login Widget
  → User clicks "Log in with Telegram"
  → Telegram returns signed user data to /api/auth/telegram/authorize (POST)
  → Server verifies HMAC-SHA256 using bot token
  → Server generates auth code, stores in Redis (TTL 5min)
  → Redirect to /api/auth/callback/telegram?code=XXX&state=YYY
  → Better Auth genericOAuth exchanges code via custom getToken()
  → getToken() reads code from Redis, returns synthetic access token
  → getUserInfo() decodes token, returns user profile
  → Better Auth finds existing user (by synthetic email tg_XXX@bot.gptweb.ru) or creates new
  → Session created, user logged in
```

## Files to Create/Modify

### New files

1. `src/libs/better-auth/sso/providers/telegram.ts` — Generic OAuth provider (like WeChat)
2. `src/app/(backend)/api/auth/telegram/authorize/route.ts` — Custom authorize endpoint with Telegram Login Widget + HMAC verification

### Modified files

3. `src/libs/better-auth/sso/index.ts` — register telegram provider
4. `src/envs/auth.ts` — AUTH_TELEGRAM_BOT_TOKEN env var
5. `src/components/AuthIcons.tsx` — Telegram icon (lucide Send)

## Provider Implementation (telegram.ts)

Generic OAuth provider following WeChat pattern:

- `type: 'generic'`
- `id: 'telegram'`
- `authorizationUrl`: `${APP_URL}/api/auth/telegram/authorize` (our custom page)
- `tokenUrl`: `${APP_URL}/api/auth/telegram/authorize` (same endpoint, POST)
- Custom `getToken()`: reads auth code from Redis, returns user data as synthetic token
- Custom `getUserInfo()`: decodes synthetic token, returns `{ id, email, name, image }`
- Synthetic email: `tg_{telegram_id}@bot.gptweb.ru` (matches bot-created accounts)

## Authorize Endpoint

### GET /api/auth/telegram/authorize

Returns HTML page with:
- Telegram Login Widget (`<script src="https://telegram.org/js/telegram-widget.js">`)
- Widget configured with bot username and callback URL
- `state` parameter preserved from query string

### POST /api/auth/telegram/authorize (or callback via widget)

1. Receives Telegram auth data (id, first_name, last_name, username, photo_url, auth_date, hash)
2. Verifies HMAC-SHA256: `hash == HMAC_SHA256(SHA256(bot_token), data_check_string)`
3. Checks auth_date is not older than 5 minutes
4. Generates random code, stores user data in Redis with key `tg-auth:{code}` (TTL 300s)
5. Redirects to `/api/auth/callback/telegram?code={code}&state={state}`

## Account Linking

Better Auth has `accountLinking: { enabled: true, allowDifferentEmails: true }`.

When getUserInfo returns email `tg_{id}@bot.gptweb.ru`:
- If user with this email exists (created by bot) → Better Auth links Telegram OAuth account to it
- If not → Better Auth creates new user with this email

Result: bot users automatically get web access with their existing chat history.

## Env Vars

```
AUTH_SSO_PROVIDERS=telegram
AUTH_TELEGRAM_BOT_TOKEN=<@gptwebrubot token>
```

## Telegram Bot Setup

In @BotFather for @gptwebrubot:
- `/setdomain` → `ask.gptweb.ru`

## Security

- HMAC-SHA256 verification prevents forged auth data
- Auth codes in Redis with 5-minute TTL prevent replay
- auth_date check prevents stale auth data
- Bot token never exposed to client
