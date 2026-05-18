# Auth Modal + Yandex/Telegram OAuth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use `- [ ]` checkboxes.

**Spec:** `docs/superpowers/specs/2026-05-18-auth-modal-with-oauth-design.md` (commit `a08fa4c668`)

**Goal:** Заменить `/signin` редирект на blurred-app + modal UX. Подключить Yandex OAuth (новый SSO provider) и Telegram Login (уже встроен в upstream — только enable env). Автосвязь TG-bot с аккаунтом на login.

**Architecture (after spec refinement):** Lobechat upstream УЖЕ имеет SSO infrastructure (`src/libs/better-auth/sso/`) и Telegram provider реализован с bot deep-link + Redis poll. План использует это, custom plugin не нужен.

**Tech Stack:** Next.js 16, React 19, Drizzle, Better Auth, antd, lobehub/ui, postgres.js.

**Repos:** `/home/deploy/projects/ai-aggregator-lobechat` (canary).

---

### Task 1: Yandex SSO provider

**Files:**

- Create: `src/libs/better-auth/sso/providers/yandex.ts`

- Modify: `src/libs/better-auth/sso/index.ts` (register provider)

- Modify: `src/libs/better-auth/constants.ts` (add to BUILTIN_BETTER_AUTH_PROVIDERS)

- Modify: `src/envs/auth.ts` (declare `AUTH_YANDEX_ID`, `AUTH_YANDEX_SECRET`)

- [ ] **Step 1: Create provider definition**

Create `src/libs/better-auth/sso/providers/yandex.ts` with:

```ts
import { authEnv } from '@/envs/auth';

import { type GenericProviderDefinition } from '../types';

/**
 * Yandex OAuth 2.0 provider.
 * Registered as a generic OAuth provider (Better Auth has no built-in Yandex).
 * Docs: https://yandex.ru/dev/id/doc/ru/codes/code-url
 */
const provider: GenericProviderDefinition<{
  AUTH_YANDEX_ID: string;
  AUTH_YANDEX_SECRET: string;
}> = {
  build: (env) => ({
    providerId: 'yandex',
    clientId: env.AUTH_YANDEX_ID,
    clientSecret: env.AUTH_YANDEX_SECRET,
    authorizationUrl: 'https://oauth.yandex.ru/authorize',
    tokenUrl: 'https://oauth.yandex.ru/token',
    userInfoUrl: 'https://login.yandex.ru/info?format=json',
    scopes: ['login:email', 'login:info', 'login:avatar'],
    mapProfileToUser: (profile: {
      id: string;
      default_email?: string;
      emails?: string[];
      real_name?: string;
      display_name?: string;
      login?: string;
      default_avatar_id?: string;
    }) => {
      const email = (profile.default_email || profile.emails?.[0] || '').toLowerCase();
      return {
        email,
        name: profile.real_name || profile.display_name || profile.login || email,
        image: profile.default_avatar_id
          ? `https://avatars.yandex.net/get-yapic/${profile.default_avatar_id}/islands-200`
          : undefined,
        emailVerified: !!profile.default_email,
      };
    },
  }),
  checkEnvs: () =>
    !!(authEnv.AUTH_YANDEX_ID && authEnv.AUTH_YANDEX_SECRET)
      ? { AUTH_YANDEX_ID: authEnv.AUTH_YANDEX_ID, AUTH_YANDEX_SECRET: authEnv.AUTH_YANDEX_SECRET }
      : false,
  id: 'yandex',
  type: 'generic',
};

export default provider;
```

- [ ] **Step 2: Register in `sso/index.ts`**

Open `src/libs/better-auth/sso/index.ts`. Find the import block of provider files (Apple, Google, Github, ...) and add:

```ts
import Yandex from './providers/yandex';
```

Then in the `providerDefinitions` array, add `Yandex` (location doesn't matter — alphabetical preferred):

```ts
const providerDefinitions = [
  Apple,
  Google,
  // ... existing ...
  Telegram,
  Wechat,
  Yandex, // ← добавить
  Zitadel,
];
```

- [ ] **Step 3: Add to BUILTIN_BETTER_AUTH_PROVIDERS in constants.ts**

Open `src/libs/better-auth/constants.ts`. Find `BUILTIN_BETTER_AUTH_PROVIDERS` array and add `'yandex'`:

```ts
export const BUILTIN_BETTER_AUTH_PROVIDERS = [
  'apple', 'auth0', ...,
  'telegram',
  'wechat',
  'yandex',  // ← добавить
  'zitadel',
];
```

- [ ] **Step 4: Add env vars to `src/envs/auth.ts`**

Open `src/envs/auth.ts`. Find existing `AUTH_GOOGLE_ID/SECRET` block and add Yandex declarations near it:

```ts
// In the schema:
AUTH_YANDEX_ID: z.string().optional(),
AUTH_YANDEX_SECRET: z.string().optional(),

// In the runtimeEnv mapping:
AUTH_YANDEX_ID: process.env.AUTH_YANDEX_ID,
AUTH_YANDEX_SECRET: process.env.AUTH_YANDEX_SECRET,
```

- [ ] **Step 5: TypeScript check**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
npx tsc --noEmit 2>&1 | grep -E "error TS" | head -10
```

Expected: 0 errors in your new file. Pre-existing errors elsewhere are OK.

- [ ] **Step 6: Commit**

```bash
git add src/libs/better-auth/sso/providers/yandex.ts src/libs/better-auth/sso/index.ts src/libs/better-auth/constants.ts src/envs/auth.ts
git commit -m "feat(auth): Yandex OAuth SSO provider"
```

---

### Task 2: Add env vars + Yandex client redirect URI

**Host config + Yandex OAuth console**

- [ ] **Step 1: Verify env vars exist in `/opt/lobechat/.env`**

```bash
grep -E "AUTH_YANDEX|YANDEX_OAUTH" /opt/lobechat/.env
```

If absent, append (user has provided credentials):

```bash
echo "" | sudo tee -a /opt/lobechat/.env > /dev/null
echo "# Yandex OAuth (added 2026-05-18)" | sudo tee -a /opt/lobechat/.env > /dev/null
echo "AUTH_YANDEX_ID=2e9ae8749a294605a187724e6e59f739" | sudo tee -a /opt/lobechat/.env > /dev/null
echo "AUTH_YANDEX_SECRET=def3c4eebc774ed7bfe64bef84f15e29" | sudo tee -a /opt/lobechat/.env > /dev/null
```

- [ ] **Step 2: Add to `/opt/lobechat/docker-compose.yml` lobe service env block**

Find the `lobe:` service `environment:` block (uses `${VAR}` substitution from `.env`).
Add two lines next to existing AUTH\_\* vars:

```yaml
- 'AUTH_YANDEX_ID=${AUTH_YANDEX_ID}'
- 'AUTH_YANDEX_SECRET=${AUTH_YANDEX_SECRET}'
```

Restart lobe with new env (DON'T --force-recreate to avoid container_name conflict bug):

```bash
cd /opt/lobechat && docker compose up -d lobe
```

- [ ] **Step 3: Add the redirect URI in Yandex OAuth console**

Open <https://oauth.yandex.ru/client/2e9ae8749a294605a187724e6e59f739> (Yandex's OAuth Apps page).
Under "Web service" → "Redirect URI", add:

```
https://ask.gptweb.ru/api/auth/oauth/yandex
```

(Better Auth's generic OAuth uses `/api/auth/oauth/<providerId>` for callback by default; this is the path the request will hit after Yandex redirects back.)

Save the change in Yandex console.

> **NOTE for implementer:** This step is manual — Claude cannot edit Yandex console for the user. Document that this MUST be done before testing.

---

### Task 3: Enable Telegram SSO env vars

Upstream already implements Telegram SSO. We just need env vars.

- [ ] **Step 1: Verify telegram env vars**

```bash
grep -E "AUTH_TELEGRAM" /opt/lobechat/.env
```

Expected: `AUTH_TELEGRAM_BOT_TOKEN=8022...` already present. If not, ask user for bot token.

Also need `AUTH_TELEGRAM_BOT_USERNAME=gptwebrubot`. If absent:

```bash
echo "AUTH_TELEGRAM_BOT_USERNAME=gptwebrubot" | sudo tee -a /opt/lobechat/.env > /dev/null
```

- [ ] **Step 2: Add to docker-compose**

In `lobe` service env, add:

```yaml
- 'AUTH_TELEGRAM_BOT_TOKEN=${AUTH_TELEGRAM_BOT_TOKEN}'
- 'AUTH_TELEGRAM_BOT_USERNAME=${AUTH_TELEGRAM_BOT_USERNAME}'
```

- [ ] **Step 3: Verify Telegram bot `@gptwebrubot` has domain set**

Open chat with `@BotFather` in Telegram. `/setdomain` → choose `@gptwebrubot` → enter `ask.gptweb.ru`. (Manual step — implementer should remind user.)

- [ ] **Step 4: Restart lobehub**

```bash
cd /opt/lobechat && docker compose up -d lobe
```

- [ ] **Step 5: Quick verify env is loaded**

```bash
docker exec $(docker ps -q --filter name=lobehub) printenv | grep -E "AUTH_YANDEX|AUTH_TELEGRAM"
```

Expected: 4 vars present.

---

### Task 4: TG bot link writeback hook

Add a post-login hook that fills `user_billing.tg_bot_chat_id` and notifies bot via HTTP after Telegram OAuth completes.

**Files:**

- Create: `src/libs/better-auth/hooks/telegram-link.ts`

- Modify: `src/libs/better-auth/define-config.ts` (wire hook into `databaseHooks`)

- Create: `src/envs/bot.ts` (or modify auth.ts) — declare `BOT_INTERNAL_TOKEN`

- [ ] **Step 1: Create hook**

`src/libs/better-auth/hooks/telegram-link.ts`:

```ts
import { sql } from 'drizzle-orm';

import { serverDB } from '@lobechat/database';
import { appEnv } from '@/envs/app';
import { authEnv } from '@/envs/auth';

const BOT_INTERNAL_URL = appEnv.BOT_INTERNAL_URL || 'http://gptwebrubot:3000';

interface AccountCreatedHookCtx {
  account: {
    userId: string;
    providerId: string;
    accountId: string; // for Telegram = tg user id as string
  };
  user: {
    name?: string;
    image?: string;
  };
  isNewUser?: boolean;
}

/**
 * Fires after Better Auth creates a `user_account` row for any provider.
 * For provider='telegram' we double-write the link to both sides:
 *   - lobechat: user_billing.tg_bot_chat_id (used by notify-bot crons)
 *   - bot.db:   POST /internal/link-user to gptwebrubot
 * Both writes are best-effort and never block auth.
 */
export async function onAccountCreated(ctx: AccountCreatedHookCtx) {
  if (ctx.account.providerId !== 'telegram') return;

  const tgId = Number(ctx.account.accountId);
  if (!Number.isFinite(tgId)) return;

  // 1) lobechat side
  try {
    await serverDB.execute(sql`
      INSERT INTO user_billing (user_id, tg_bot_chat_id, plan_id)
      VALUES (${ctx.account.userId}, ${tgId}, 1)
      ON CONFLICT (user_id) DO UPDATE
      SET tg_bot_chat_id = EXCLUDED.tg_bot_chat_id
      WHERE user_billing.tg_bot_chat_id IS DISTINCT FROM EXCLUDED.tg_bot_chat_id
    `);
  } catch (e) {
    console.error('[tg-link-hook] failed to set tg_bot_chat_id', e);
  }

  // 2) bot.db side via HTTP
  const token = process.env.BOT_INTERNAL_TOKEN;
  if (!token) {
    console.warn('[tg-link-hook] BOT_INTERNAL_TOKEN not set, skipping bot.db sync');
    return;
  }
  try {
    await fetch(`${BOT_INTERNAL_URL}/internal/link-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Token': token },
      body: JSON.stringify({
        tg_user_id: tgId,
        tg_chat_id: tgId,
        lobechat_user_id: ctx.account.userId,
        first_name: ctx.user.name,
        source: ctx.isNewUser ? 'auth_signup' : 'auth_relink',
      }),
    });
  } catch (e) {
    console.error('[tg-link-hook] bot link HTTP failed', e);
  }
}
```

- [ ] **Step 2: Wire hook in `define-config.ts`**

Open `src/libs/better-auth/define-config.ts`. Find `databaseHooks` block (or `account` callbacks in Better Auth options). Add:

```ts
import { onAccountCreated } from '@/libs/better-auth/hooks/telegram-link';

// inside betterAuth({...}):
databaseHooks: {
  account: {
    create: {
      after: async (account, ctx) => {
        await onAccountCreated({
          account: { userId: account.userId, providerId: account.providerId, accountId: account.accountId },
          user: { name: ctx?.context?.user?.name, image: ctx?.context?.user?.image },
          isNewUser: !!ctx?.context?.isNewUser,
        });
      },
    },
  },
},
```

**Note:** Better Auth's exact `databaseHooks` shape may vary by version. Verify at impl: `grep -rn "databaseHooks" node_modules/better-auth/dist 2>/dev/null | head`. If the hook signature differs, mirror it.

- [ ] **Step 3: Add `BOT_INTERNAL_TOKEN` env var**

Generate a secret:

```bash
openssl rand -hex 32
```

Add to `/opt/lobechat/.env`:

```
BOT_INTERNAL_TOKEN=<generated>
BOT_INTERNAL_URL=http://gptwebrubot:3000
```

Add to docker-compose:

```yaml
- 'BOT_INTERNAL_TOKEN=${BOT_INTERNAL_TOKEN}'
- 'BOT_INTERNAL_URL=${BOT_INTERNAL_URL}'
```

Declare in `src/envs/app.ts`:

```ts
BOT_INTERNAL_URL: z.string().optional(),
BOT_INTERNAL_TOKEN: z.string().optional(),
```

Same env vars must also be set on `gptwebrubot` side (Task 5).

- [ ] **Step 4: TS check + commit**

```bash
npx tsc --noEmit 2>&1 | grep -E "error TS" | head
git add src/libs/better-auth/hooks/telegram-link.ts src/libs/better-auth/define-config.ts src/envs/app.ts
git commit -m "feat(auth): auto-link tg_bot_chat_id and bot.db after Telegram OAuth"
```

---

### Task 5: gptwebrubot `POST /internal/link-user` endpoint

**Repo:** `/home/deploy/projects/gptwebrubot`
**Files:**

- Modify: `src/server.ts` — add new route

- Modify: `src/db.ts` — add helper for upserting tg_chat_id + telegram_users in one call

- [ ] **Step 1: Add upsert helpers in `src/db.ts`**

Find the existing `rememberChatId(tgUserId, chatId)` function. Below it add:

```ts
export function upsertLink(args: {
  tg_user_id: number;
  tg_chat_id: number;
  lobechat_user_id: string;
}) {
  db.prepare(
    `INSERT INTO tg_chat_id (tg_user_id, chat_id, last_seen_ms)
     VALUES (?, ?, ?)
     ON CONFLICT (tg_user_id) DO UPDATE
     SET chat_id = excluded.chat_id, last_seen_ms = excluded.last_seen_ms`,
  ).run(args.tg_user_id, args.tg_chat_id, Date.now());

  // Default model for new users; do not overwrite existing preferred_model.
  db.prepare(
    `INSERT INTO telegram_users (telegram_id, lobechat_user_id, preferred_model, current_topic_id)
     VALUES (?, ?, 'gpt-4o-mini', NULL)
     ON CONFLICT (telegram_id) DO UPDATE
     SET lobechat_user_id = excluded.lobechat_user_id`,
  ).run(String(args.tg_user_id), args.lobechat_user_id);
}
```

- [ ] **Step 2: Add route in `src/server.ts`**

Find existing route registrations (POST handlers). Add:

```ts
app.post('/internal/link-user', async (c) => {
  // Auth check
  if (c.req.header('x-internal-token') !== process.env.BOT_INTERNAL_TOKEN) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const body = await c.req.json();
  const tgUserId = Number(body.tg_user_id);
  const tgChatId = Number(body.tg_chat_id ?? body.tg_user_id);
  const lobechatUserId = String(body.lobechat_user_id || '');
  const firstName = body.first_name as string | undefined;
  const source = body.source as string | undefined;

  if (!Number.isFinite(tgUserId) || !lobechatUserId) {
    return c.json({ error: 'tg_user_id and lobechat_user_id required' }, 400);
  }

  upsertLink({ tg_user_id: tgUserId, tg_chat_id: tgChatId, lobechat_user_id: lobechatUserId });

  // Welcome message only for fresh signups
  if (source === 'auth_signup' && tgChatId) {
    try {
      await bot.api.sendMessage(
        tgChatId,
        `Привет, ${firstName || 'друг'}! ` +
          `Твой WebGPT-аккаунт связан с этим Telegram. ` +
          `Просто пиши сюда — я отвечу через GPT/Claude. ` +
          `Кредиты и история шарятся с веб-версией: https://ask.gptweb.ru`,
      );
    } catch (e) {
      console.error('[link-user] welcome send failed', e);
    }
  }

  return c.json({ ok: true });
});
```

(Adjust to the actual framework used — Hono uses `c.req.header(...)` and `c.json(...)`. If it's grammY+Bun directly, mirror the existing route style.)

- [ ] **Step 3: Add `BOT_INTERNAL_TOKEN` env to gptwebrubot**

Edit `/home/deploy/projects/gptwebrubot/.env`:

```
BOT_INTERNAL_TOKEN=<same value as lobechat side>
```

- [ ] **Step 4: Restart gptwebrubot**

```bash
sudo systemctl restart gptwebrubot
sudo journalctl -u gptwebrubot --since '30 seconds ago' -n 20
```

Expected: bot starts cleanly. Look for the new route registered (`POST /internal/link-user`).

- [ ] **Step 5: Smoke test**

```bash
curl -sS -X POST http://localhost:3000/internal/link-user \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: $BOT_INTERNAL_TOKEN" \
  -d '{"tg_user_id":99999,"tg_chat_id":99999,"lobechat_user_id":"test-uuid-stub"}'
```

Expected: `{"ok":true}`. Then verify DB:

```bash
python3 -c "import sqlite3;c=sqlite3.connect('/home/deploy/projects/gptwebrubot/bot.db');print(c.execute('SELECT * FROM telegram_users WHERE telegram_id=?',('99999',)).fetchone())"
```

Expected: tuple with stub row. Then cleanup:

```bash
python3 -c "import sqlite3;c=sqlite3.connect('/home/deploy/projects/gptwebrubot/bot.db');c.execute('DELETE FROM telegram_users WHERE telegram_id=?',('99999',));c.execute('DELETE FROM tg_chat_id WHERE tg_user_id=?',(99999,));c.commit()"
```

- [ ] **Step 6: Commit**

```bash
cd /home/deploy/projects/gptwebrubot
git add src/server.ts src/db.ts
git commit -m "feat(bot): /internal/link-user endpoint for lobechat OAuth auto-link"
```

---

### Task 6: Frontend AuthGuardOverlay + AuthModal

**Files (all new):**

- `src/features/AuthGuard/AuthGuardOverlay.tsx`

- `src/features/AuthGuard/AuthModal.tsx`

- `src/features/AuthGuard/YandexButton.tsx`

- `src/features/AuthGuard/TelegramWidget.tsx`

- `src/features/AuthGuard/EmailSignIn.tsx`

- `src/features/AuthGuard/EmailSignUp.tsx`

- `src/features/AuthGuard/index.ts`

- [ ] **Step 1: AuthGuardOverlay (the wrapper)**

`src/features/AuthGuard/AuthGuardOverlay.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';

import AuthModal from './AuthModal';

export default function AuthGuardOverlay() {
  // We need to know the auth tab on initial render — read from URL once.
  const [initialTab, setInitialTab] = useState<'signin' | 'signup'>('signup');

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('auth');
    if (p === 'signin') setInitialTab('signin');
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <AuthModal defaultTab={initialTab} />
    </div>
  );
}
```

- [ ] **Step 2: AuthModal (tab container)**

`src/features/AuthGuard/AuthModal.tsx`:

```tsx
'use client';
import { Card, Divider, Tabs } from 'antd';
import { memo, useState } from 'react';

import EmailSignIn from './EmailSignIn';
import EmailSignUp from './EmailSignUp';
import TelegramWidget from './TelegramWidget';
import YandexButton from './YandexButton';

interface Props {
  defaultTab: 'signin' | 'signup';
}

export default memo<Props>(function AuthModal({ defaultTab }) {
  const [tab, setTab] = useState<'signin' | 'signup'>(defaultTab);

  return (
    <Card style={{ width: 420, maxWidth: '100%', borderRadius: 16 }}>
      <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>
        {tab === 'signup' ? 'Создать аккаунт WebGPT' : 'Войти'}
      </h2>
      <p style={{ marginTop: 6, fontSize: 13, color: '#666' }}>
        {tab === 'signup' ? 'Бесплатные кредиты, GPT/Claude/Gemini, без VPN' : 'С возвращением!'}
      </p>

      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <YandexButton mode={tab} />
        <TelegramWidget />
      </div>

      <Divider plain style={{ marginBlock: 16, fontSize: 12, color: '#999' }}>
        или email
      </Divider>

      {tab === 'signup' ? <EmailSignUp /> : <EmailSignIn />}

      <div style={{ marginTop: 16, textAlign: 'center', fontSize: 13 }}>
        {tab === 'signup' ? (
          <>
            Уже есть аккаунт?{' '}
            <a onClick={() => setTab('signin')} style={{ cursor: 'pointer' }}>
              Войти
            </a>
          </>
        ) : (
          <>
            Нет аккаунта?{' '}
            <a onClick={() => setTab('signup')} style={{ cursor: 'pointer' }}>
              Зарегистрироваться
            </a>
          </>
        )}
      </div>
    </Card>
  );
});
```

- [ ] **Step 3: YandexButton**

`src/features/AuthGuard/YandexButton.tsx`:

```tsx
'use client';

interface Props {
  mode: 'signin' | 'signup';
}

export default function YandexButton({ mode }: Props) {
  return (
    <a
      href="/api/auth/sign-in/social?provider=yandex"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height: 44,
        padding: '0 16px',
        borderRadius: 8,
        background: '#FC3F1D',
        color: '#fff',
        fontWeight: 500,
        fontSize: 14,
        textDecoration: 'none',
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M13.4 11.5L17 21h-3l-3.5-9.4L7 21H4l4.6-12L4 0h3l3.6 9.5L14 0h3l-3.6 11.5z" />
      </svg>
      {mode === 'signin' ? 'Войти через Яндекс' : 'Регистрация через Яндекс'}
    </a>
  );
}
```

- [ ] **Step 4: TelegramWidget**

`src/features/AuthGuard/TelegramWidget.tsx`:

```tsx
'use client';

// Upstream lobechat Telegram SSO uses a custom /api/auth/telegram/authorize page
// (deep-link to bot + Redis-poll). We trigger it by sending the user to
// Better Auth's social sign-in, which redirects to that authorize page.
export default function TelegramWidget() {
  return (
    <a
      href="/api/auth/sign-in/social?provider=telegram"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height: 44,
        padding: '0 16px',
        borderRadius: 8,
        background: '#0088cc',
        color: '#fff',
        fontWeight: 500,
        fontSize: 14,
        textDecoration: 'none',
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.6 0 12 0zm5.6 8.3c-.2 1.9-1 6.5-1.4 8.7-.2.9-.5 1.2-.9 1.3-.8.1-1.4-.5-2.1-1l-3.2-2.1-1.6 1.4c-.2.2-.4.4-.7.4l.3-3.6 6.4-5.8c.3-.2-.1-.4-.4-.2l-7.9 5-3.4-1c-.7-.2-.7-.7.2-1l13.4-5.2c.6-.2 1.1.1 1 .7z" />
      </svg>
      Войти через Telegram
    </a>
  );
}
```

- [ ] **Step 5: EmailSignIn / EmailSignUp**

Reuse the existing `useSignIn` hook from `src/app/[variants]/(auth)/signin/useSignIn.ts` and the signup hook (find it: `grep -rln "auth.signUp.email\|/api/auth/sign-up" src/app/[variants]/(auth)/signup`).

Both EmailSignIn and EmailSignUp render a simple form with email + password (+ name for signup). On submit they call the Better Auth client (`auth.signIn.email(...)` or `auth.signUp.email(...)`).

Skeleton for `EmailSignIn.tsx`:

```tsx
'use client';
import { Button, Form, Input } from 'antd';
import { useState } from 'react';

import { authClient } from '@/libs/better-auth/auth-client';

export default function EmailSignIn() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFinish(values: { email: string; password: string }) {
    setLoading(true);
    setError(null);
    try {
      const res = await authClient.signIn.email({
        email: values.email,
        password: values.password,
      });
      if (res.error) throw new Error(res.error.message || 'Не удалось войти');
      window.location.reload(); // session cookie set → reload removes the overlay
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Form layout="vertical" onFinish={onFinish}>
      <Form.Item name="email" rules={[{ required: true, type: 'email' }]}>
        <Input placeholder="Email" size="large" />
      </Form.Item>
      <Form.Item name="password" rules={[{ required: true, min: 6 }]}>
        <Input.Password placeholder="Пароль" size="large" />
      </Form.Item>
      {error && <div style={{ color: '#e53e3e', fontSize: 12, marginBottom: 8 }}>{error}</div>}
      <Button block htmlType="submit" loading={loading} size="large" type="primary">
        Войти
      </Button>
    </Form>
  );
}
```

EmailSignUp mirrors it with extra `name` field and `authClient.signUp.email(...)`.

- [ ] **Step 6: index.ts**

```ts
export { default as AuthGuardOverlay } from './AuthGuardOverlay';
```

- [ ] **Step 7: Build verify + commit**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
pnpm build 2>&1 | tail -15
git add src/features/AuthGuard/
git commit -m "feat(auth): AuthGuard overlay components (modal + Yandex + Telegram + email)"
```

> **Note:** `pnpm build` may take 10+ min. If you need a faster TS check only:
> `npx tsc --noEmit 2>&1 | grep -E "error TS" | head`

---

### Task 7: Mount AuthGuardOverlay into root layout

**File:** likely `src/app/[variants]/(main)/layout.tsx`. Confirm with grep first.

- [ ] **Step 1: Find current main layout and the auth-redirect logic**

```bash
grep -rn "redirect.*signin\|router.*signin\|redirect('/signin')\|isLogin" \
  src/app/[variants]/(main)/layout.tsx src/app/[variants]/layout.tsx 2>/dev/null
```

Locate where unauthenticated users are currently redirected to `/signin`. This is the line we replace with rendering AuthGuardOverlay instead.

- [ ] **Step 2: Conditional render in layout**

In the main layout (around the children render), wrap:

```tsx
import dynamic from 'next/dynamic';

const AuthGuardOverlay = dynamic(() => import('@/features/AuthGuard/AuthGuardOverlay'), {
  ssr: false,
});

// Replace any `if (!isLogin) redirect('/signin')` with:
return (
  <>
    <div
      style={{
        filter: isLogin ? undefined : 'blur(8px)',
        pointerEvents: isLogin ? undefined : 'none',
        transition: 'filter 200ms ease',
      }}
    >
      {children}
    </div>
    {!isLogin && <AuthGuardOverlay />}
  </>
);
```

> **NOTE:** `isLogin` source depends on existing layout — it might come from `useUserStore(authSelectors.isLogin)` (client) or from server-side cookie check. Mirror the existing pattern. If layout is server-side, switch to: `const session = await auth.api.getSession(...)`.

- [ ] **Step 3: Verify NO automatic redirect remains for unauthenticated users**

```bash
grep -rn "redirect.*signin\|redirect('/login\|redirect('/signin" src/app/[variants]/(main) src/middleware* 2>/dev/null
```

Expected: 0 hits. If any remain, replace with `null` / overlay render.

- [ ] **Step 4: Build + commit**

```bash
pnpm build 2>&1 | tail -10
git add src/app/[variants]/(main)/layout.tsx
git commit -m "feat(auth): blur + AuthGuardOverlay instead of /signin redirect"
```

---

### Task 8: Legacy URL redirects in middleware

**File:** `src/libs/next/proxy/define-config.ts` (lobechat's request proxy/middleware).

- [ ] **Step 1: Add legacy URL block at the top of middleware**

```ts
const LEGACY_AUTH_ROUTES: Record<string, 'signin' | 'signup'> = {
  '/signin': 'signin',
  '/login': 'signin',
  '/signup': 'signup',
  '/register': 'signup',
};

// near the top of middleware, before any other handler:
const legacy = LEGACY_AUTH_ROUTES[request.nextUrl.pathname];
if (legacy) {
  const dest = new URL('/', request.url);
  dest.searchParams.set('auth', legacy);
  // Preserve UTM and other query params
  request.nextUrl.searchParams.forEach((v, k) => {
    if (k !== 'auth') dest.searchParams.set(k, v);
  });
  return NextResponse.redirect(dest, 308);
}
```

> **Caveat:** Existing `/(auth)/signin/page.tsx` is a static page rendered by Next at /signin. Middleware redirects BEFORE the page renders, so the legacy route effectively goes dark. Verify by running `curl -I -L https://ask.gptweb.ru/signin` after deploy — expect 308 → 200 at `/?auth=signin`.

- [ ] **Step 2: Build + commit**

```bash
pnpm build 2>&1 | tail -10
git add src/libs/next/proxy/define-config.ts
git commit -m "feat(auth): redirect legacy /signin /register URLs to /?auth=..."
```

---

### Task 9: Push, rebuild, deploy

- [ ] **Step 1: Push canary**

```bash
git push origin canary
```

- [ ] **Step 2: Trigger or watch GHA**

```bash
gh run watch $(gh run list --branch canary --limit 1 --json databaseId --jq '.[0].databaseId')
```

Expected: GHA passes (including new static-chunk smoke check from earlier session work).

If GHA's `deploy-canary` workflow isn't auto-triggered, run docker build manually on host:

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
nohup docker build --tag lobechat-custom:latest --progress=plain . > /tmp/lobe-auth-build.log 2>&1 &
# wait...
cd /opt/lobechat && docker compose up -d lobe
```

- [ ] **Step 3: gptwebrubot redeploy**

```bash
sudo systemctl restart gptwebrubot
sudo journalctl -u gptwebrubot --since '30 seconds ago' -n 20
```

---

### Task 10: End-to-end test

- [ ] **Step 1: Test Yandex flow in incognito**

Open `https://ask.gptweb.ru/` in private window. Expect:

- Blurred app + AuthModal on top (Sign Up tab default)

- Click «Через Яндекс» → redirect to oauth.yandex.ru

- Consent → redirect back → session cookie set → blur off, app visible

- Check in DB: `SELECT id, email FROM users ORDER BY created_at DESC LIMIT 1;` shows the new Yandex user

- [ ] **Step 2: Test Telegram flow**

Same private window. Click «Войти через Telegram» → bot deep-link opens in TG → confirm in bot → return to web → logged in.

Verify auto-link:

```bash
docker exec lobe-postgres psql -U postgres -d lobechat -c "
SELECT u.id, u.email, ub.tg_bot_chat_id FROM users u JOIN user_billing ub ON ub.user_id=u.id ORDER BY u.created_at DESC LIMIT 1;"
```

Expected: `tg_bot_chat_id` matches the user's TG id.

```bash
python3 -c "import sqlite3;c=sqlite3.connect('/home/deploy/projects/gptwebrubot/bot.db');print(c.execute('SELECT * FROM telegram_users ORDER BY ROWID DESC LIMIT 1').fetchone())"
```

Expected: row with `lobechat_user_id` matching the new user. Welcome message in TG client.

- [ ] **Step 3: Test email signup**

Submit email + password in EmailSignUp form. Expect: user created, email verification flow triggered (existing logic), Better Auth session cookie set.

- [ ] **Step 4: Test legacy URL redirects**

```bash
curl -sS -o /dev/null -L -w "%{url_effective} → %{http_code}\n" https://ask.gptweb.ru/signin
curl -sS -o /dev/null -L -w "%{url_effective} → %{http_code}\n" "https://ask.gptweb.ru/register?utm_source=landing&utm_campaign=header"
```

Expected:

- `/signin` → `/?auth=signin` (200)
- `/register?utm_source=landing&utm_campaign=header` → `/?auth=signup&utm_source=landing&utm_campaign=header` (200)

UTM params preserved.

- [ ] **Step 5: Cleanup test accounts**

```sql
DELETE FROM users WHERE email LIKE '%test%' OR email LIKE 'tg-%@telegram.local' ORDER BY created_at DESC LIMIT 10;
```

(Only delete YOUR test accounts. Verify list before delete.)

---

### Task 11: KNOWLEDGE.md update

- [ ] **Step 1: Add Phase 15 to `/home/deploy/projects/ai-aggregator-lobechat/KNOWLEDGE.md`**

```markdown
## Phase 15: Auth Modal + Yandex/Telegram OAuth (2026-05-18)

### UX shift

- Untransited users no longer redirected to /signin; root layout renders blurred app + AuthModal overlay.
- Legacy URLs (/signin /login /signup /register) → 308 redirect on `/?auth=signin|signup` with preserved UTM params.

### SSO providers added

- Yandex: new file `src/libs/better-auth/sso/providers/yandex.ts`. Env: AUTH_YANDEX_ID, AUTH_YANDEX_SECRET. Redirect URI: https://ask.gptweb.ru/api/auth/oauth/yandex.
- Telegram: already in upstream (`providers/telegram.ts`). Env: AUTH_TELEGRAM_BOT_TOKEN (= gptwebrubot bot), AUTH_TELEGRAM_BOT_USERNAME=gptwebrubot. @BotFather setdomain to ask.gptweb.ru required.

### TG auto-link (no /settings step)

- `src/libs/better-auth/hooks/telegram-link.ts` — databaseHooks.account.create.after:
  - UPSERT user_billing.tg_bot_chat_id (lobechat PG)
  - POST gptwebrubot:3000/internal/link-user (writes both tg_chat_id and telegram_users in bot.db, sends welcome on signup)
- BOT_INTERNAL_TOKEN shared between lobechat env and gptwebrubot .env.

### Pitfalls

- Better Auth's databaseHooks signature varies between versions — verify the exact shape in node_modules/better-auth/dist if hook doesn't fire.
- Telegram bot must have `setdomain` for ask.gptweb.ru via @BotFather, else Login Widget refuses.
- Yandex redirect URI MUST be added in Yandex OAuth console (manual step).
- Auto-link by email only when emailVerified=true from provider (Yandex default_email is verified).
- Telegram users have synthetic email tg-<id>@telegram.local; broadcasts to these users skip (not deliverable).
```

- [ ] **Step 2: Commit**

```bash
git add KNOWLEDGE.md
git commit -m "docs(knowledge): Phase 15 auth modal + Yandex/Telegram OAuth"
git push origin canary
```

---

## Final acceptance checklist

After all 11 tasks:

- [ ] Incognito open of `/` shows blurred app + AuthModal (Sign Up default)
- [ ] Yandex button flow creates user, sets session, redirects back, blur off
- [ ] Telegram button flow creates user, sets session, AND `user_billing.tg_bot_chat_id` filled, AND `telegram_users.lobechat_user_id` in bot.db filled
- [ ] Welcome message arrives in TG for new signups
- [ ] Email signup/signin works as before
- [ ] `/signin`, `/login`, `/signup`, `/register` all → 308 redirect with UTM preserved
- [ ] GHA static-chunk smoke check passes
- [ ] Real users register through the new flow (monitor `SELECT count(*) FROM users WHERE created_at > <fix_time>` first 1h)
