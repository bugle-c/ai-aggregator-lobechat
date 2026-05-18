# Auth Modal + Yandex/Telegram OAuth — Design Spec

**Date:** 2026-05-18
**Goal:** Заменить редирект `/` → `/signin` на UX «заблюренная страница + модалка сверху». Добавить OAuth-логин через Яндекс и Telegram Login Widget. Сохранить email/password.

---

## 1. Цели и не-цели

### Цели

- Любой URL у незалогиненного юзера: показывается **заблюренный** UI приложения + поверх него **модалка** с табами Sign Up / Sign In.
- Tab по умолчанию: **Sign Up** (новые юзеры — основной поток).
- Кнопки: «Через Яндекс», «Через Telegram», форма email+пароль.
- OAuth Yandex/Telegram **авто-link**'ует к существующему юзеру по email (trust on verified email).
- Legacy URLs `/signin`, `/signup`, `/register` → redirect на `/?auth=signin|signup` (не ломаем landing CTA + старые email-ссылки).

### Не-цели (v1)

- Не делаем «Сначала спроси юзера про linking» — авто-link сразу.
- Не делаем 2FA для OAuth (не имеет смысла).
- Не делаем UI «Привязать ещё провайдеров» в /settings (потом, если запросит).
- Не меняем существующий Google OAuth (если активен).

---

## 2. Архитектура

**Стек:** Next.js 16 App Router + Better Auth (custom plugins) + tRPC + lobehub/ui.

**Better Auth** уже имеет:

- `oAuthSSOProviders` инфраструктуру (генерик OAuth providers — для Yandex)
- `useSignIn` hook с `handleSocialSignIn`
- `/api/auth/sign-up/email` и `/api/auth/sign-in/email` endpoints

Используем стандартный Better Auth flow для Yandex (через `genericOAuth` plugin), для Telegram — custom plugin (стандартного нет).

### 2.1 Поток для Sign Up (новый юзер)

```
User → /  (или любой URL)
  ↓ middleware: detect not-logged-in
  ↓ Layout renders <App> + <AuthGuardOverlay>
  ↓ <AuthGuardOverlay>:
      - бекдроп с blur + dim
      - <AuthModal defaultTab="signup">
         - Tab Sign Up: email/password form + Yandex button + Telegram widget
         - Tab Sign In: same UI
  ↓ User clicks "Через Яндекс":
      → window.location = /api/auth/sign-in/social?provider=yandex
      → Better Auth redirects to oauth.yandex.ru/authorize
      → Yandex consent screen
      → callback /api/auth/callback/yandex
      → Better Auth: createAccount or linkByEmail → set session cookie
      → Server redirect: /  (юзер залогинен — overlay снимается)
```

### 2.2 Поток для Telegram Login Widget

```
User clicks Telegram widget button
  → Widget opens t.me/gptwebrubot popup with auth request
  → User confirms in Telegram
  → Widget script callback: receives {id, first_name, last_name, username, photo_url, auth_date, hash}
  → Frontend POST /api/auth/telegram with this data
  → Backend: verify HMAC using AUTH_TELEGRAM_BOT_TOKEN (SHA256 of sorted fields)
  → if valid:
      - lookup user_account.telegram_user_id = id
      - if not found: lookup user.email = username@telegram (fallback) — actually not viable
      - if not found: createUser + createAccount with no email (или сразу спросить email на следующем шаге)
  → Set Better Auth session cookie
  → Return success → frontend reloads
```

**Telegram caveat:** Widget не возвращает email. Если юзера нет в БД → создать без email; в первый заход показать модалку «Введите email чтобы получать оповещения» (но это v1.5 — пока создаём без email).

Для существующих юзеров: link по `telegram_user_id` (новая колонка в `user_account` или `users`).

---

## 3. DB-миграция

Добавить в **lobechat PG** (Drizzle schema `users.ts` или `auth_accounts.ts`):

```sql
-- Single source of truth: link OAuth provider IDs to user.
-- Better Auth уже имеет таблицу user_account (OAuth accounts). Используем её
-- для yandex и нашего custom telegram provider — не вводим новые колонки в users.
SELECT column_name FROM information_schema.columns WHERE table_name = 'user_accounts';
-- Expected: id, user_id, account_id, provider_id, access_token, refresh_token, ...
```

`user_accounts` уже поддерживает arbitrary `provider_id` ("yandex", "telegram", ...). Нам **миграция БД не нужна** — Better Auth справится сам через generic OAuth + custom plugin.

Единственный новый аспект — для Telegram нужно убедиться что Better Auth примет `provider_id='telegram'` + `account_id=<telegram_user_id>`. Это standard.

---

## 4. Backend changes (lobechat)

### 4.1 Better Auth config (`src/libs/better-auth/index.ts` или похожий)

```ts
import { betterAuth } from 'better-auth';
import { genericOAuth } from 'better-auth/plugins';

export const auth = betterAuth({
  // ... existing config ...
  plugins: [
    genericOAuth({
      config: [
        {
          providerId: 'yandex',
          clientId: process.env.YANDEX_OAUTH_CLIENT_ID!,
          clientSecret: process.env.YANDEX_OAUTH_CLIENT_SECRET!,
          authorizationUrl: 'https://oauth.yandex.ru/authorize',
          tokenUrl: 'https://oauth.yandex.ru/token',
          userInfoUrl: 'https://login.yandex.ru/info?format=json',
          mapProfileToUser: (profile) => ({
            email: (profile.default_email || profile.emails?.[0] || '').toLowerCase(),
            name: profile.real_name || profile.display_name || profile.login,
            image: profile.default_avatar_id
              ? `https://avatars.yandex.net/get-yapic/${profile.default_avatar_id}/islands-200`
              : undefined,
            emailVerified: !!profile.default_email,
          }),
          scopes: ['login:email', 'login:info', 'login:avatar'],
        },
      ],
      // Critical: auto-link by email for trusted providers
      linkAccountByEmail: true,
    }),
    telegramAuth({
      // custom plugin, see §4.2
      botToken: process.env.AUTH_TELEGRAM_BOT_TOKEN!,
      botUsername: 'gptwebrubot',
    }),
  ],
});
```

**Note:** Better Auth's `genericOAuth` plugin's exact API may differ — confirm at impl time via `pnpm view better-auth-plugins` or docs. The `linkAccountByEmail: true` semantics need to be checked: в худшем случае пишем post-create hook.

### 4.2 Custom Telegram plugin

Файл: `src/libs/better-auth/plugins/telegram.ts`. Реализует один endpoint `POST /api/auth/telegram/verify`:

```ts
import crypto from 'crypto';
import { type BetterAuthPlugin } from 'better-auth';

interface TelegramAuthData {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

export const telegramAuth = (opts: {
  botToken: string;
  botUsername: string;
}): BetterAuthPlugin => ({
  id: 'telegram',
  endpoints: {
    telegramVerify: {
      path: '/telegram/verify',
      method: 'POST',
      handler: async (ctx) => {
        const data = ctx.body as TelegramAuthData;

        // 1) Verify HMAC: see https://core.telegram.org/widgets/login#checking-authorization
        const { hash, ...fields } = data;
        const dataCheckString = Object.entries(fields)
          .filter(([_, v]) => v !== undefined)
          .map(([k, v]) => `${k}=${v}`)
          .sort()
          .join('\n');
        const secretKey = crypto.createHash('sha256').update(opts.botToken).digest();
        const expectedHash = crypto
          .createHmac('sha256', secretKey)
          .update(dataCheckString)
          .digest('hex');

        if (expectedHash !== hash) {
          return ctx.json({ error: 'invalid_hash' }, { status: 401 });
        }

        // 2) Reject stale auth_date (>1 day old)
        if (Date.now() / 1000 - data.auth_date > 86400) {
          return ctx.json({ error: 'stale_auth' }, { status: 401 });
        }

        // 3) Lookup or create user_account
        const tgAccountId = String(data.id);
        const existing = await ctx.context.adapter.findOne({
          model: 'account',
          where: [
            { field: 'providerId', value: 'telegram' },
            { field: 'accountId', value: tgAccountId },
          ],
        });

        let userId: string;
        if (existing) {
          userId = existing.userId;
        } else {
          // Telegram doesn't return email. Create user with synthetic placeholder
          // — we'll prompt for real email post-login in v1.5.
          const newUser = await ctx.context.adapter.create({
            model: 'user',
            data: {
              email: `tg-${data.id}@telegram.local`, // placeholder, will replace in v1.5
              name:
                [data.first_name, data.last_name].filter(Boolean).join(' ') ||
                data.username ||
                `tg-${data.id}`,
              image: data.photo_url,
              emailVerified: false,
            },
          });
          userId = newUser.id;
          await ctx.context.adapter.create({
            model: 'account',
            data: {
              userId,
              providerId: 'telegram',
              accountId: tgAccountId,
            },
          });
          // Also persist tg_chat_id ↔ user_id in bot's lookup table (HTTP call to gptwebrubot)
          // — best effort, async, don't block auth on failure
          try {
            await fetch(`http://gptwebrubot:3000/internal/link-user`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Internal-Token': process.env.BOT_INTERNAL_TOKEN!,
              },
              body: JSON.stringify({ tg_user_id: data.id, lobechat_user_id: userId }),
            });
          } catch (e) {
            console.error('[telegram-auth] bot link failed', e);
          }
        }

        // 4) Set session cookie via Better Auth helper
        const session = await ctx.context.internalAdapter.createSession(userId, ctx);
        await ctx.setCookie(ctx.context.sessionCookieName, session.token, {
          httpOnly: true,
          sameSite: 'lax',
          secure: true,
          path: '/',
        });

        return ctx.json({ ok: true, userId });
      },
    },
  },
});
```

Endpoint URL: `POST /api/auth/telegram/verify` (Better Auth префиксит `/api/auth`).

---

## 5. Frontend changes

### 5.1 New components

```
src/features/AuthGuard/
├── AuthGuardOverlay.tsx       — backdrop + blur + render <AuthModal>
├── AuthModal.tsx              — Tabs + tab content
├── EmailForm.tsx              — email + password (existing useSignIn hook)
├── SignUpForm.tsx             — email + password + name (reuse Better Auth signup)
├── YandexButton.tsx           — <a href="/api/auth/sign-in/social?provider=yandex">
├── TelegramWidget.tsx         — embeds Telegram <script> with data-onauth callback
└── index.ts
```

### 5.2 AuthGuardOverlay placement

В корневом layout (`src/app/[variants]/(main)/layout.tsx` или похожий):

```tsx
'use client';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';
import AuthGuardOverlay from '@/features/AuthGuard/AuthGuardOverlay';

export default function MainLayout({ children }) {
  const isLogin = useUserStore(authSelectors.isLogin);
  return (
    <>
      <div
        style={{ filter: isLogin ? 'none' : 'blur(8px)', pointerEvents: isLogin ? 'auto' : 'none' }}
      >
        {children}
      </div>
      {!isLogin && <AuthGuardOverlay />}
    </>
  );
}
```

Альтернатива: монтировать на уровне root layout (`src/app/[variants]/layout.tsx`), чтобы он работал и на /image, /video, /settings/\*. Решаем в импл.

### 5.3 Tab default = signup

```tsx
const sp = useSearchParams();
const initialTab = sp.get('auth') === 'signin' ? 'signin' : 'signup';
```

### 5.4 Yandex button

```tsx
<a href="/api/auth/sign-in/social?provider=yandex" className="...">
  <YandexIcon /> Войти через Яндекс
</a>
```

Better Auth разрулит redirect → exchange → set session.

### 5.5 Telegram Widget

Стандартный embed:

```tsx
useEffect(() => {
  const script = document.createElement('script');
  script.src = 'https://telegram.org/js/telegram-widget.js?22';
  script.setAttribute('data-telegram-login', 'gptwebrubot');
  script.setAttribute('data-size', 'large');
  script.setAttribute('data-userpic', 'false');
  script.setAttribute('data-onauth', 'onTelegramAuth(user)');
  script.setAttribute('data-request-access', 'write');
  containerRef.current?.appendChild(script);

  (window as any).onTelegramAuth = async (user) => {
    const res = await fetch('/api/auth/telegram/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user),
    });
    if (res.ok) location.reload();
    else alert('Не удалось войти через Telegram');
  };

  return () => {
    delete (window as any).onTelegramAuth;
  };
}, []);
```

---

## 6. Middleware updates

`src/libs/next/proxy/define-config.ts` (или middleware.ts):

```ts
// Legacy URL redirects
const legacyAuthRoutes: Record<string, string> = {
  '/signin': '/?auth=signin',
  '/login': '/?auth=signin',
  '/signup': '/?auth=signup',
  '/register': '/?auth=signup',
};

if (legacyAuthRoutes[pathname]) {
  const dest = new URL(legacyAuthRoutes[pathname], req.url);
  // Preserve query params (utm_*, etc.) — important for attribution
  req.nextUrl.searchParams.forEach((v, k) => dest.searchParams.set(k, v));
  return NextResponse.redirect(dest, 308);
}

// Whitelist OAuth callback endpoints from public route check
// (Better Auth already adds /api/auth/* to public, verify)
```

---

## 7. Env vars (production `/opt/lobechat/.env`)

Добавить:

```
# Yandex OAuth
YANDEX_OAUTH_CLIENT_ID=<from user input — already provided>
YANDEX_OAUTH_CLIENT_SECRET=<from user input — already provided>

# Telegram Login Widget — reuse AUTH_TELEGRAM_BOT_TOKEN (gptwebrubot)
# AUTH_TELEGRAM_BOT_TOKEN already set
TELEGRAM_LOGIN_BOT_USERNAME=gptwebrubot

# Internal token for lobechat → gptwebrubot link-user webhook
BOT_INTERNAL_TOKEN=<generate openssl rand -hex 32>
```

И эквивалентные ENV декларации в `src/envs/auth.ts` / `betterAuth.ts`.

В Yandex OAuth console — добавить **Redirect URI**:
`https://ask.gptweb.ru/api/auth/callback/yandex`

В @BotFather для gptwebrubot:

- `/setdomain` → `ask.gptweb.ru` (если ещё не установлен)

---

## 8. UX-нюансы

### 8.1 Юзер заходит впервые

- `/` → blur + modal "Sign Up" tab default
- Видит 3 опции: Yandex / Telegram / email-password
- Жмёт Yandex → редирект → consent → возвращается залогиненным

### 8.2 Юзер уже залогинен

- `/` → blur=off → modal не рендерится → видит обычное приложение

### 8.3 Юзер заходит на /image без аккаунта

- `/image` → видит blur'еный image-генератор + modal "Sign Up"
- После логина — overlay снимается, остаётся на /image

### 8.4 Юзер кликает «Войти через Yandex» на странице /register?utm_source=...

- Параметры query сохраняются в Yandex state cookie
- После callback редирект на `/?utm_source=...` (либо на `?next=<original>`)

### 8.5 Email forgotten password

- Sign In tab имеет ссылку "Забыли пароль?"
- Открывает второй overlay (reset password) — переиспользуем существующий `/(auth)/reset-password` через iframe или inline (импл detail)

---

## 9. Что НЕ переписываем

- `/(auth)/verify-email` — оставляем как есть (email подтверждение работает через token-link)
- `/(auth)/reset-password` — оставляем как есть, ссылку из модалки ведёт сюда
- Better Auth signin endpoint (`/api/auth/sign-in/email`) — используем напрямую, не оборачиваем

---

## 10. Безопасность

- Yandex state validation — Better Auth делает сам через oauth state cookie.
- Telegram HMAC verify — реализован в custom plugin (§4.2).
- Telegram replay attack — `auth_date` старше 24ч отклоняется.
- Auto-link by email — только при `emailVerified=true` от Yandex (default_email Yandex'a верифицирован). Telegram не возвращает email, link only по `telegram_user_id`.
- CSRF на POST /api/auth/telegram/verify — Better Auth добавит CSRF token.
- Open redirect protection — `next` параметр в session cookie только относительный URL, не absolute.

---

## 11. Test plan

### 11.1 Pre-launch acceptance

- [ ] `GET /` (no session) → HTML с `filter:blur(...)` + AuthModal в DOM
- [ ] `GET /signin` → 308 redirect на `/?auth=signin`
- [ ] `GET /register?utm_source=landing` → 308 redirect на `/?auth=signup&utm_source=landing`
- [ ] Click «Через Яндекс» → редирект на `oauth.yandex.ru/authorize?...client_id=...redirect_uri=...`
- [ ] Yandex callback с code → создаётся юзер в `users` + account в `user_accounts` (provider=yandex) → session cookie set → редирект на `/`
- [ ] Yandex с email который УЖЕ есть в БД → НЕ создаёт нового юзера, link к существующему userId, session set
- [ ] Telegram widget после `onAuthCallback` → POST /api/auth/telegram/verify с правильным hash → 200 + session cookie
- [ ] Telegram widget с подделанным hash → 401 invalid_hash
- [ ] Telegram widget с auth_date > 24h → 401 stale_auth
- [ ] Залогиненный юзер на `/` → blur off, AuthModal не виден

### 11.2 Production rollout

1. Deploy на canary через GHA
2. Smoke test: открыть инкогнито → видеть модалку signup на /
3. Real Yandex login → проверить в БД user_accounts + users
4. Real Telegram login → проверить tg_chat_id в bot.db
5. Мониторим `users.created_at` count первые 24ч → ожидается +20-50% к baseline

---

## 12. Сроки

Оценка 4-6 часов:

- Better Auth genericOAuth config для Yandex: 45 мин
- Custom Telegram plugin: 90 мин (HMAC + adapter calls + tests)
- AuthGuardOverlay + AuthModal + 3 sub-components: 90 мин
- Middleware redirects + env wiring: 30 мин
- Test + rebuild + deploy: 60 мин
- Buffer на Better Auth gotchas: 60 мин

## 13. Открытые риски

- **Better Auth `genericOAuth` plugin может иметь устаревший API** — если не работает с Yandex как есть (например Yandex's userinfo не в Bearer form), пишем custom OAuth-router (как x10seo).
- **Telegram email placeholder** — `tg-<id>@telegram.local` не пройдёт mailto-валидацию в Brevo. Не блокирует регистрацию, но broadcast'ы на TG-only юзеров не уйдут. v1.5: prompt for real email post-login.
- **Auto-link security** — если злонамеренник создаёт Yandex-аккаунт с email жертвы (например `victim@gmail.com` в Yandex настройках) → может перехватить аккаунт. Mitigation: Yandex требует confirmed email для login:email scope — это уже их проверка. Принимаем.

## 14. Changelog

- 2026-05-18 v1.0 — first draft
