# Magic-5min Sprint 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the four S-fixes from the approved spec (`docs/superpowers/specs/2026-07-06-magic-5min-onboarding-design.md`): intent passthrough from blog, Telegram-first auth, default-model health-guard, trust checkout badges, human-unit balance/pricing.

**Architecture:** All app changes ride the existing LobeChat fork surfaces (AuthModal, home InputArea editor, cron routes with `CRON_SECRET`, alerts service, Plans page, BalanceBadge, LowBalanceWarning). Blog CTA change lives in the separate `webgpt-landing` repo. No new tables; consecutive-failure state for the health-guard uses the existing `process_orchestration` pattern.

**Tech Stack:** Next.js 16 + React 19, antd/antd-style, Zustand, tRPC, Drizzle/Postgres (`lobe-postgres`), system cron + `CRON_SECRET`, `src/server/services/alerts` (TG delivery).

**Deviations from spec (agreed engineering judgement):**

1. S2 auto-repoint on 2nd consecutive failure is replaced by a **CRITICAL alert containing the ready-to-run repoint SQL**. Mass-writing `user_settings` from a cron on a possible false positive is riskier than a 1-minute manual action. Revisit after a month of alert data.
2. S3 SBP-first is **already shipped** (`yookassa.ts` defaults `'sbp'` for top-ups; subscriptions stay `bank_card` for recurring). S3 therefore = trust badges/copy only.

**Verification gate for every app task:** `cd /home/deploy/projects/ai-aggregator-lobechat && npx next build --webpack` must exit 0 (do NOT use `npm run build` — its prebuild lint fails on unrelated legacy files). Work on branch `feat/magic-sprint1`; merge to `canary` only at the end.

---

### Task 1: Intent passthrough `?prompt=` → prefilled chat input

**Files:**

- Create: `src/app/[variants]/(main)/home/features/InputArea/useIntentPrompt.ts`

- Modify: `src/app/[variants]/(main)/home/features/InputArea/index.tsx` (call the hook)

- [ ] **Step 1: Write the hook**

```ts
// useIntentPrompt.ts
import { useEffect } from 'react';

import { useChatStore } from '@/store/chat';

const STORAGE_KEY = 'webgpt_pending_intent_prompt';

/**
 * Blog CTAs deep-link with `?prompt=<template>`. Capture it BEFORE auth can
 * navigate away (sessionStorage survives the OAuth round-trip), then prefill
 * the main chat editor once it exists and the user is on the home surface.
 * One-shot: consumed on successful prefill.
 */
export const useIntentPrompt = () => {
  // Capture phase — run once on mount, even for anonymous visitors.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const prompt = params.get('prompt');
    if (!prompt) return;
    sessionStorage.setItem(STORAGE_KEY, prompt.slice(0, 2000));
    // Strip the param so reloads/auth redirects don't re-capture.
    params.delete('prompt');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
  }, []);

  // Inject phase — poll briefly for the editor (it mounts after hydration).
  useEffect(() => {
    const pending = sessionStorage.getItem(STORAGE_KEY);
    if (!pending) return;
    let tries = 0;
    const timer = setInterval(() => {
      const editor = useChatStore.getState().mainInputEditor;
      tries += 1;
      if (editor) {
        editor.instance?.setDocument('markdown', pending);
        useChatStore.setState({ inputMessage: pending });
        editor.focus();
        sessionStorage.removeItem(STORAGE_KEY);
        clearInterval(timer);
      } else if (tries > 40) {
        clearInterval(timer); // ~10s: editor never mounted (e.g. auth wall) — keep for next visit
      }
    }, 250);
    return () => clearInterval(timer);
  }, []);
};
```

- [ ] **Step 2: Wire into InputArea** — in `home/features/InputArea/index.tsx`, next to `useInitStarterAgents()` add:

```ts
import { useIntentPrompt } from './useIntentPrompt';
// inside the component body:
useIntentPrompt();
```

- [ ] **Step 3: Build gate** — `npx next build --webpack` → exit 0.
- [ ] **Step 4: Manual check** — open `https://ask.gptweb.ru/?prompt=Привет%20тест` headless (Playwright, remove auth overlay): the input contains «Привет тест».
- [ ] **Step 5: Commit** — `git commit -m "feat(onboarding): intent passthrough ?prompt= into chat editor"`

### Task 2: AuthModal — Telegram first, email collapsed

**Files:**

- Modify: `src/features/AuthGuard/AuthModal.tsx`

- [ ] **Step 1: Reorder SSO buttons** — swap so `<TelegramButton …/>` renders ABOVE `<YandexButton …/>` (persona data: TG-native is the largest segment; two-tap entry).

- [ ] **Step 2: Collapse email form behind a link.** Add state and replace the always-visible email block:

```tsx
const [showEmail, setShowEmail] = useState(false);
// …replace the <Divider>или по email</Divider> + form block with:
{
  showEmail ? (
    <>
      <Divider plain style={{ marginBlock: 18, fontSize: 12, color: '#999' }}>
        по email
      </Divider>
      {tab === 'signup' ? <EmailSignUp disabled={gate} /> : <EmailSignIn />}
    </>
  ) : (
    <div style={{ marginTop: 14, textAlign: 'center', fontSize: 13 }}>
      <Typography.Link onClick={() => setShowEmail(true)}>Войти по почте</Typography.Link>
    </div>
  );
}
```

Keep the consent checkbox + `gate` logic exactly as-is (it gates SSO buttons regardless).

- [ ] **Step 3: Build gate**, **Step 4: headless screenshot** of the signup overlay (TG on top, email link visible), **Step 5: Commit** — `feat(auth): telegram-first sign-in, email collapsed`.

### Task 3: Blog CTA with intent template (repo `webgpt-landing`)

**Files:**

- Modify: `/home/deploy/projects/webgpt-landing/components/blog/blog-cta.tsx`

- [ ] **Step 1: Read the current component**, then extend it to accept an optional prompt and rewrite the copy:

```tsx
interface BlogCtaProps {
  prompt?: string;
} // merge into existing props

const href = prompt
  ? `https://ask.gptweb.ru/?prompt=${encodeURIComponent(prompt)}`
  : 'https://ask.gptweb.ru/';
// CTA copy (replace generic): «Получи готовый результат за 2 минуты —
// вход через Telegram, без карты»
```

- [ ] **Step 2: Default template map by category.** In the same file export a small map so article pages can pass a template without editing every post: `{ 'texts': 'Напиши продающий пост для ВК: {услуга}, {акция}, {срок} — живым языком, с эмодзи', 'images': 'Нарисуй {что} в стиле {стиль}, реалистичное фото', 'docs': 'Составь {документ} для {ситуация}, со ссылками на законы РФ' }` and wire `prompt={CATEGORY_PROMPTS[post.category] ?? undefined}` at the call site in `app/blog/[category]/[slug]/page.tsx`.
- [ ] **Step 3: Build** — `npm run build` in webgpt-landing → exit 0.
- [ ] **Step 4: Commit + push `main`** (landing auto-deploys) — `feat(blog): CTA deep-links intent template into the app`.
- [ ] **Step 5: Live check** — a blog article CTA lands on ask.gptweb.ru with the input prefilled (uses Task 1).

### Task 4: Default-model health-guard cron

**Files:**

- Create: `src/app/(backend)/api/cron/model-health/route.ts`

- Modify: host crontab (`crontab -e` for deploy user)

- [ ] **Step 1: Write the route** (pattern-copy auth from `api/cron/billing-sanity-checks/route.ts:45`):

```ts
import { NextResponse } from 'next/server';

import { DEFAULT_MODEL } from '@lobechat/const/settings/llm'; // 'gpt-5-mini' — verify import path via existing usages
import { serverDB } from '@/database/server';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime'; // same helper the video route uses (src/server/routers/lambda/video/index.ts:207) — verify exact import
import { sendAlert } from '@/server/services/alerts'; // verify exported name in src/server/services/alerts/index.ts

export const maxDuration = 60;

const REPOINT_SQL = `UPDATE user_settings SET default_agent = jsonb_set(jsonb_set(default_agent,'{config,model}','"gpt-5-mini"'),'{config,provider}','"lobehub"') WHERE default_agent->'config'->>'provider' NOT IN ('lobehub','openrouter');`;

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const userId = process.env.HEALTHCHECK_USER_ID;
  if (!userId) return NextResponse.json({ error: 'HEALTHCHECK_USER_ID unset' }, { status: 500 });

  try {
    const runtime = await initModelRuntimeFromDB(serverDB, userId, 'lobehub');
    const res = await runtime.chat({
      messages: [{ content: 'ping', role: 'user' }],
      model: DEFAULT_MODEL,
      stream: false,
      max_tokens: 1,
    } as any);
    void res;
    return NextResponse.json({ model: DEFAULT_MODEL, ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sendAlert(
      `🔴 MODEL HEALTH: дефолтная модель ${DEFAULT_MODEL}/lobehub НЕ отвечает: ${msg.slice(0, 300)}\n\nЕсли повторится 2 раза подряд — новые юзеры получают мёртвый чат. Repoint SQL:\n${REPOINT_SQL}`,
    );
    return NextResponse.json({ error: msg, ok: false }, { status: 502 });
  }
}
```

Implementer MUST verify the three marked imports against real exports before building (grep usages; adjust names, keep behavior).

- [ ] **Step 2: Set env** — `HEALTHCHECK_USER_ID=<owner user id>` on the lobehub container env file used at deploy (same mechanism as other envs; note: survives GHA deploys only if added via the compose/env file, not `docker service update`).
- [ ] **Step 3: Build gate.**
- [ ] **Step 4: Crontab** (host):

```cron
*/15 * * * * curl -s -m 55 -H "Authorization: Bearer $CRON_SECRET" https://ask.gptweb.ru/api/cron/model-health >/dev/null 2>&1
```

Follow the existing crontab entries' style (they inline the literal secret — do the same).

- [ ] **Step 5: Smoke** — `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3210/api/cron/model-health` → `{"ok":true}`. Then temporarily test alert path by pointing model to a bogus id in a scratch call (NOT committed).
- [ ] **Step 6: Commit** — `feat(ops): default-model health-guard cron with TG alert`.

### Task 5: Trust badges on Plans + funds

**Files:**

- Create: `src/components/PaymentTrustBadges/index.tsx`

- Modify: `src/business/client/BusinessSettingPages/Plans.tsx` (render under the plan cards)

- Modify: the funds/top-up page (locate: `grep -rn "subscription/funds" src/app | head`) — render above the pay button

- [ ] **Step 1: Component**

```tsx
'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

/**
 * Trust strip under checkout surfaces. The #1 stated payment objection across
 * all five personas is fear of auto-charge — our payments ARE one-off, say it.
 */
const PaymentTrustBadges = memo(() => (
  <Flexbox
    gap={4}
    style={{ color: 'var(--ant-color-text-tertiary)', fontSize: 12, lineHeight: 1.6 }}
  >
    <span>✅ Разовый платёж — без автосписаний и скрытых продлений</span>
    <span>🏦 Оплата через ЮKassa: СБП, карты Мир/Visa/MC · чек на почту</span>
    <span>ИП Верстин П.С. · ИНН 333412952925 · поддержка hello@gptweb.ru</span>
  </Flexbox>
));

export default PaymentTrustBadges;
```

NOTE: subscriptions DO auto-renew? Verify: if `YOOKASSA_RECURRING_ENABLED=1` renews subscriptions, the first line must be scoped: on the SUBSCRIPTION card say «Продление — только с вашего подтверждения» ONLY if true, else omit the line there and keep it on one-time top-ups. Implementer checks `renew-due-subscriptions` cron semantics and adjusts copy honestly. Не обещать того, чего нет — это юридически чувствительный текст.

- [ ] **Step 2: Mount** in Plans.tsx below the cards and on the funds page above the CTA.
- [ ] **Step 3: Build gate**, headless screenshot of /settings/plans, **Commit** — `feat(billing): trust badges on checkout surfaces`.

### Task 6: Human units — balance & plans & earlier low-balance nudge

**Files:**

- Create: `src/business/utils/creditsToHuman.ts`

- Modify: `locales/ru-RU/onboarding.json` + `src/locales/default/onboarding.ts` (balance.label tooltip)

- Modify: `src/features/Onboarding/BalanceBadge.tsx` (tooltip line)

- Modify: `src/business/client/BusinessSettingPages/Plans.tsx` (per-plan «≈ N постов и M картинок»)

- Modify: `src/components/LowBalanceWarning/LowBalanceWarning.tsx:53` (threshold 80 → 50, softer copy below 80)

- [ ] **Step 1: Converter** (single source of the rough rates; keep in sync with Supabase `model_rates` — comment says so):

```ts
/** Rough human-work equivalents. 1 credit ≈ 1 gpt-5-mini answer; an image ≈ 7 credits. */
export const CHAT_CREDITS = 1;
export const IMAGE_CREDITS = 7;

export const creditsToHuman = (credits: number) => ({
  answers: Math.floor(credits / CHAT_CREDITS),
  images: Math.floor(credits / IMAGE_CREDITS),
});
```

- [ ] **Step 2: BalanceBadge tooltip** — under the existing label add `«≈ {images} картинок или {answers} ответов»` via a new i18n key `balance.human` (both locale files).
- [ ] **Step 3: Plans rows** — under each plan price render `≈ ${human.answers} ответов или ${human.images} картинок` from the plan's `token_limit`.
- [ ] **Step 4: LowBalanceWarning** — change line 53 gate to `usagePercent < 50`; for 50–79% render `type='info'` with softer title («Израсходована половина лимита — осталось ≈ N картинок»), keep the current warning for ≥80. Keep the WebGPT Mini switch link as-is.
- [ ] **Step 5: Build gate + commit** — `feat(billing): balance and plans in human work units, earlier soft low-balance nudge`.

### Task 7: Merge + deploy + verify

- [ ] `git checkout canary && git merge --ff-only feat/magic-sprint1 && git push origin canary`
- [ ] Monitor lobehub restart (`docker inspect StartedAt` change + HTTP 200).
- [ ] Headless pass: `?prompt=` prefill; signup overlay (TG first); /settings/plans (badges + human units).
- [ ] `curl` model-health cron → ok:true; crontab entry active.
- [ ] Journal entry in `/home/deploy/projects/JOURNAL.md`.
