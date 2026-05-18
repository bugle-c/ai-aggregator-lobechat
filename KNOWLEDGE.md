# KNOWLEDGE.md — ai-aggregator-lobechat

## Overview

Fork of LobeChat (`lobehub/lobe-chat`) customized for ask.gptweb.ru with YooKassa billing and Russian market support.

**GitHub:** `bugle-c/ai-aggregator-lobechat` (private), branch `canary`
**Upstream:** `lobehub/lobe-chat`, branch `canary`

## Architecture

- **Stack:** Next.js 16 + React 19 + Drizzle ORM + Better Auth + tRPC + antd
- **DB:** ParadeDB/PG17 in Docker (port 5433), database `lobechat`
- **Docker:** 7 containers in `/opt/lobechat/` (VPS #1: 135.181.115.234)
- **Image:** `lobechat-custom:latest` (built locally from this repo)
- **Reverse proxy:** Caddy on `ask.gptweb.ru`

## Migration Phases

| Phase      | Status | Description                                             |
| ---------- | ------ | ------------------------------------------------------- |
| 1. Deploy  | Done   | Docker stack, Caddy, DNS                                |
| 2. Auth    | Done   | Better Auth, user migration (4 users, bcrypt)           |
| 3. Billing | Done   | YooKassa payments, plans (Free/Basic/Pro), usage limits |
| 4. Bot     | Done   | Standalone gptwebrubot (Bun+grammY) → LobeChat webapi   |
| 5. UI      | Done   | WebGPT rebrand, Russian locale (ru-RU), custom icons    |
| 6. Cleanup | Done   | Removed litellm-proxy, ai-aggregator-bot, Dokploy app   |

## Phase 3: Billing (YooKassa)

### Created files

- `packages/database/src/schemas/billing.ts` — 3 tables: billing_plans, billing_payments, user_billing
- `src/envs/billing.ts` — YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY env config
- `src/server/services/billing/index.ts` — BillingService class (DB queries)
- `src/server/modules/billing/yookassa.ts` — YooKassa API client
- `src/server/modules/billing/fulfill.ts` — Payment fulfillment + cancellation
- `src/server/modules/billing/constants.ts` — Topup packages
- `src/server/modules/billing/checkUsageLimit.ts` — Usage limit check + token recording
- `src/app/(backend)/api/billing/webhook/route.ts` — YooKassa webhook handler

### Modified files

- `packages/types/src/subscription.ts` — Plans enum: Free/Basic/Pro (was Free/Hobby/Starter/Premium/Ultimate)
- `src/business/server/user.ts` — getSubscriptionPlan() queries DB, initNewUserForBusiness() creates billing record
- `src/business/server/lambda-routers/subscription.ts` — createPayment, getBillingState, getPlans, getPayments
- `src/business/server/lambda-routers/topUp.ts` — createPayment, getPackages
- `src/business/server/lambda-routers/spend.ts` — getUsageSummary
- `src/app/(backend)/webapi/chat/[provider]/route.ts` — Usage limit check before chat
- `src/business/server/image-generation/chargeBeforeGenerate.ts` — Usage limit check
- `src/business/server/image-generation/chargeAfterGenerate.ts` — Token recording
- `src/business/server/video-generation/chargeBeforeGenerate.ts` — Usage limit check
- `src/business/server/video-generation/chargeAfterGenerate.ts` — Token recording
- `src/features/PlanIcon/index.tsx` — Updated for Free/Basic/Pro
- `src/locales/default/subscription.ts` — Updated plan locale keys
- `src/libs/next/proxy/define-config.ts` — Added /api/billing to public routes

### Billing plans

| Plan  | Price     | Token Limit/Month |
| ----- | --------- | ----------------- |
| Free  | 0 RUB     | 50,000            |
| Basic | 490 RUB   | 500,000           |
| Pro   | 1,490 RUB | 5,000,000         |

### Topup packages

| Price     | Tokens    |
| --------- | --------- |
| 199 RUB   | 500,000   |
| 699 RUB   | 2,000,000 |
| 1,499 RUB | 5,000,000 |

### Key decisions

- **Fail-open** on usage limit check errors (don't block users on billing bugs)
- **Lazy monthly reset** — tokensUsedMonth resets when billingResetDate < now
- **Webhook always returns 200** to prevent YooKassa retries on errors
- **No Drizzle relations** defined — use direct `db.select().from()` queries
- **Dynamic import** for billing in chat route to avoid circular dependencies

## Phase 7: Full Rebrand (2026-02-26)

### What was done

- Replaced ALL "LobeChat/LobeHub/Lobe AI" → "WebGPT" in \~70 files
- Categories: locale files (src/locales/default/_.ts + locales/en-US/_.json + locales/ru-RU/\*.json), components, email templates, OIDC config, JSON-LD, copyright, manifest
- Logos: copied from webgpt-landing (logo.png 1080x1080), resized for favicon, apple-touch-icon, PWA icons
- BRANDING_LOGO_URL changed from /logo.svg to /logo.png

### Key branding files

- `packages/business/const/src/branding.ts` — BRANDING_NAME, LOGO_URL, ORG_NAME, SOCIAL_URL, BRANDING_EMAIL
- `packages/const/src/url.ts` — OFFICIAL_URL, OFFICIAL_SITE, FEEDBACK
- `src/server/ld.ts` — JSON-LD Organization (Russian description)
- `src/libs/better-auth/email-templates/` — email branding
- `src/libs/oidc-provider/config.ts` — OIDC client names

### What was NOT changed (intentionally)

- Import paths (@lobechat/_, @lobehub/_) — library references
- Internal type names (LobeChatDatabase, etc.)
- Desktop/Electron app files — not used
- Variable/function names (handleAskLobeAI, etc.)

## Phase 8: Admin Panel Integration (2026-02-27)

### What was done

- Added `adminEmails` field to `GlobalServerConfig` type (`packages/types/src/serverConfig.ts`)
- Server-side parsing of `ADMIN_EMAILS` env var in `src/server/globalConfig/index.ts`
- Selector `adminEmails` in `src/store/serverConfig/selectors.ts`
- Admin tab (ShieldCheckIcon) in sidebar Nav.tsx — visible only for users in ADMIN_EMAILS list
- Click navigates to `/admin/` (webgpt-admin app, served on same domain via Caddy)
- Fixed Docker build: `tsgo --noEmit` fails on `@aws-sdk/client-bedrock-runtime` resolution in workspace — `build:docker` now skips type-check

### Key env var

- `ADMIN_EMAILS` — comma-separated emails (already in `/opt/lobechat/.env`)

## Pitfalls

- **tsgo vs tsc in Docker** — `tsgo` has stricter module resolution, fails on workspace deps not hoisted to root in Docker. `build:docker` uses `lint:ts + lint:style` only (no type-check)
- **drizzle-kit push is interactive** — use raw SQL for migrations, not `drizzle-kit push`
- **Better Auth middleware blocks webhooks** — must add routes to `isPublicRoute` in `define-config.ts`
- **PlanIcon references plan names directly** — when changing Plans enum, update PlanIcon themes + locale keys
- **ESLint bans console.log** — use `console.info` instead
- **tRPC endpoints are at `/trpc/lambda/...`** not `/trpc/...`
- **`@/database/server`** is the correct import for server-side DB, not `@/database/core/db-adaptor`
- **pnpm** for deps, **bun/bunx** for running scripts
- **@opentelemetry/semantic-conventions** — doesn't resolve in Docker build, constants inlined
- **SOCIAL_URL values** — MUST be strings (not undefined), \~10 components expect string href
- **Dev lock file** — `rm -f .next/dev/lock` if dev server won't start
- **Port 3100** — taken by Docker network, use 3300 for dev

## Build & Deploy

```bash
# === Dev mode (instant hot reload) ===
cd /home/deploy/projects/ai-aggregator-lobechat
npx next dev -p 3300
# Open http://135.181.115.234:3300

# === Prod build & deploy ===
cd /home/deploy/projects/ai-aggregator-lobechat
docker build -t lobechat-custom:latest . # ~5-8 min
cd /opt/lobechat && docker compose up -d lobe
docker logs lobehub --tail 50

# === Test webhook ===
curl -X POST http://localhost:3210/api/billing/webhook \
  -H "Content-Type: application/json" \
  -d '{"type":"notification","event":"payment.succeeded","object":{"id":"test"}}'
```

## Phase 9: Billing UI for Web (2026-03-01)

### What was done

- Flipped `ENABLE_BUSINESS_FEATURES = true` in `packages/business/const/src/index.ts`
- Rewrote 5 desktop-only iframe components into native React components:
  - `Plans.tsx` — plan cards, usage progress, topup packages (tRPC: subscription.getPlans, getBillingState, createPayment; topUp.getPackages, createPayment)
  - `Usage.tsx` — usage summary with progress bar and statistics (tRPC: spend.getUsageSummary)
  - `Billing.tsx` — payment history table with success banner on `?payment=success` (tRPC: subscription.getPayments)
  - `Funds.tsx` — balance display + topup packages (tRPC: spend.getUsageSummary, topUp.getPackages, createPayment)
  - `Referral.tsx` — placeholder "coming soon" (referralRouter is empty)
- Deleted `SubscriptionIframeWrapper.tsx` (161 lines of Electron-only code)

### Key decisions

- **No FormGroup/Form wrapper** — used antd Card + Flexbox + Grid pattern (simpler, matches the non-form nature of these pages)
- **`lambdaQuery` hooks** — `useQuery()` for data fetching, `useMutation()` for payments
- **Payment flow** — `createPayment.mutate()` → `window.location.href = paymentUrl` (hard redirect to YooKassa)
- **Success detection** — `?payment=success` URL param checked via `useMemo` + `URLSearchParams`
- **i18n** — `useTranslation('subscription')` namespace, all keys already existed in `locales/ru-RU/subscription.json`

### Files changed

| File                                                                     | Action                            |
| ------------------------------------------------------------------------ | --------------------------------- |
| `packages/business/const/src/index.ts`                                   | `ENABLE_BUSINESS_FEATURES = true` |
| `src/business/client/BusinessSettingPages/Plans.tsx`                     | Rewritten                         |
| `src/business/client/BusinessSettingPages/Usage.tsx`                     | Rewritten                         |
| `src/business/client/BusinessSettingPages/Billing.tsx`                   | Rewritten                         |
| `src/business/client/BusinessSettingPages/Funds.tsx`                     | Rewritten                         |
| `src/business/client/BusinessSettingPages/Referral.tsx`                  | Rewritten                         |
| `src/business/client/BusinessSettingPages/SubscriptionIframeWrapper.tsx` | Deleted                           |

## Env Vars (in /opt/lobechat/.env)

- `YOOKASSA_SHOP_ID` — YooKassa shop ID (empty = billing disabled)
- `YOOKASSA_SECRET_KEY` — YooKassa secret key
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` — AI provider keys (direct, no proxy)
- `OPENROUTER_API_KEY` — empty, not yet configured

## Pricing & Plan Tiers (2026-04-20, plans source refactored 2026-04-23)

### Source of truth — `ai_aggregator.plans` in Supabase

**Since 2026-04-23 plans live in Supabase, NOT in LobeChat PG.** Edited from webgpt-admin `/admin/finance/plans`. Landing (`gptweb.ru/`) and this aggregator both read from the same Supabase table — no more split-brain.

- Aggregator: `src/server/services/billing/plans-source.ts` — Supabase REST + in-memory cache (TTL 60s, stale-on-error fallback). `BillingService.getActivePlans/getPlanById` now delegate here; direct imports available (`fetchActivePlans`, `fetchPlanById`, `fetchPlanBySlug`).
- LobeChat PG `billing_plans` left as frozen artifact — FK dropped (user_billing/billing_payments/billing_subscription_events), code no longer reads. Safe to `DROP TABLE` in a separate migration + remove `billingPlans` from `packages/database/src/schemas/billing.ts`.
- IDs aligned 1:1 between old and new: free=1, basic=2, pro=3. `user_billing.plan_id` integer values still valid — they reference `ai_aggregator.plans.id` now.

### Active plans

| slug  | name     | price_rub | token_limit/mo | daily_credit_limit | max_tier |
| ----- | -------- | --------- | -------------- | ------------------ | -------- |
| free  | Старт    | 0         | 20             | 10                 | cheap    |
| basic | Стандарт | 490       | 2500           | 500                | mid      |
| pro   | Про      | 1490      | 8000           | 2000               | premium  |

### Credit economics

- `CREDIT_VALUE_RUB = 0.15` ₽ per credit → 1 credit ≈ $0.0015 at `USD_TO_RUB = 100`
- Break-even credits = `price_rub / CREDIT_VALUE_RUB`. Limits set at 70-80% of break-even for margin:
  - Basic: break-even 3266, limit 2500 → \~25% gross margin cap
  - Pro: break-even 9933, limit 8000 → \~20% gross margin cap
- Free has no break-even; 20/mo is a taster budget only

### Model tier gating (`src/server/modules/billing/model-tiers.ts`)

Tier = classification by **output price per 1M tokens**:

- `cheap` ≤ $1 (deepseek-chat, gpt-5-nano/mini, gemini-2.5-flash, gpt-4o-mini, MiniMax)
- `mid` ≤ $5 (claude-haiku, gpt-4.1-mini, gemini-3-flash, o4-mini, kimi)
- `high` ≤ $15 (gpt-5.1, gemini-pro, gpt-4.1, o3, claude-sonnet-4-6, grok-4, gpt-5.2)
- `premium` > $15 (claude-opus, gpt-4-turbo)

Plan → max tier: `free=cheap`, `basic=mid`, `pro=premium`. Unknown models default to `high` (safe — only Pro). Enforced in `webapi/chat/[provider]/route.ts` BEFORE streaming: blocked returns 403 `{errorType: 'PlanLimitExceeded', requiredPlan}`.

### Daily rate limit

`checkUsageLimit()` sums `usage_logs.credits_charged` in last 24h. Blocks if ≥ `daily_credit_limit`. Runs before the monthly check.

### Why these numbers — 2026-04-20 audit

- Free user `opttorgrussia@yandex.com` consumed $10 of Claude Opus in one day (22 msgs, 751k chars). `user_billing.tokens_used_month = 10` at the time — **tracker undercounted by \~600×**.
- Root cause: chat route fallback passed `outputTokens=0` when upstream `usageData` was missing.
- Two fixes landed same day: (A) tier gating — Free can no longer request Opus/premium at all; (B) stream-tallying fallback that counts observed output chars/4 when upstream omits `usage`.
- Expected: Free capped at ≤ 10 credits/day ≈ 1.5 ₽/day ≈ $0.015 per user per day. Monthly worst case per Free user: 20 credits × 0.15 = 3 ₽.
- **Lesson**: never size plan break-even assuming uniform credit cost — one premium request can be 100-1000× a cheap one. Always combine monthly cap + daily rate limit + tier gate.

### Changing limits

Edit through `/admin/finance/plans` (writes to `ai_aggregator.plans`). Aggregator picks up changes within 60s (cache TTL). Tier → plan mapping lives in `PLAN_MAX_TIER` (`model-tiers.ts`) — adding a new plan = insert row via admin + add entry to `PLAN_MAX_TIER` + rebuild image.

## Phase 12: Ollama (local LLM) — 2026-05-11

Ollama in Docker at `/opt/ollama/` (bound to `127.0.0.1:11434` on host, container on bridge `ollama_default`). LobeChat reaches it via container name `ollama` — `network-service` attaches to `ollama_default` as an external network and `lobe` shares that netns via `network_mode: 'service:network-service'`. **`extra_hosts` cannot be used on a service with `network_mode: service:X`** (Docker rejects: "conflicting options: custom host-to-IP mapping and the network mode") — that's why we joined the network instead of using `host.docker.internal`.

Three models live in `OLLAMA_MODEL_LIST` (`.env`):

| Model id                                                   | Display                 | Tier  | Plan gate |
| ---------------------------------------------------------- | ----------------------- | ----- | --------- |
| `gemma4:e4b`                                               | Gemma 4 E4B (бесплатно) | cheap | free+     |
| `hf.co/TrevorJS/gemma-4-26B-A4B-it-uncensored-GGUF:Q4_K_M` | Gemma 4 26B Uncensored  | mid   | basic+    |
| `qwen3-coder:30b-32k`                                      | Qwen3-Coder 30B         | mid   | basic+    |

Pricing rows in `ai_aggregator.model_rates` — all three at `input_per_1m=0, output_per_1m=0, markup=1` (no per-token charge; we eat CPU electricity). `tier_override` does the plan-gating. To turn off any model: PUT `is_active=false` via `/webapi/admin/model-rates`, then drop from `OLLAMA_MODEL_LIST` and `docker compose up -d` lobe.

The free Gemma 4 E4B is the only model a `free` plan user can reach (their `PLAN_MAX_TIER` is `cheap`). Free-plan daily caps still apply per `TIER_DAILY_CAPS` — for `free: {}` no caps right now, but since per-token cost is 0 the credit limit is also untouched.

Bot mirror (`gptwebrubot/src/models.ts`) has a `local` category with the same three ids — bot must be kept in sync manually since its model list is hardcoded.

## Phase 13: Visual generators async + presets + recovery (2026-05-11..17)

### Async image generation

- WaveSpeed has async API: `POST /api/v3/{model}` → `{ inferenceId, pollUrl }` → poll until status=`completed`.
- `packages/model-runtime/src/providers/wavespeed/createImage.ts` split into `submitWaveSpeedImage()` + `checkWaveSpeedImage()` (keeps legacy sync `createWaveSpeedImage` for fallback).
- `src/server/routers/async/image.ts` — if `WAVESPEED_API_KEY` set, **always** submits async (provider check removed — aggregator routes through `lobehub` provider, not `wavespeed`); stores `inferenceId` + `pollUrl` in `async_task.metadata`; returns `{ success: true, asyncPending: true }`. Falls back to sync only on submit error.
- Cron `poll-active-image-jobs` — every 20s, calls `checkWaveSpeedImage`, on `completed` downloads PNG → uploads to S3 → calls `chargeAfterGenerate`. Bearer-guarded.
- Cron `timeout-stuck-image-jobs` — every 1min, marks tasks `Error` after 10min stuck, refunds credits.
- Same pattern duplicated for video: `poll-stuck-video-jobs`, `timeout-stuck-video-jobs` (1h threshold for video).
- `cron/reconcile-pending-payments` — every 10min catches `billing_payments` stuck without YK ID after 5min (mark failed) or polls YK for completed/canceled status.

### AsyncTask gotchas

- `AsyncTaskStatus` is STRING enum (`'pending'|'processing'|'success'|'error'`), NOT numeric. Easy mistake when writing manual SQL.
- `asyncTaskModel.listActiveByType` extended to return Pending+Processing always + Error rows in the last 7 days (so UI tiles linger after failure, not vanish).

### S3 presign split

- `src/server/modules/S3/index.ts` has a SECOND client (`presignClient`) bound to `S3_PUBLIC_DOMAIN` (e.g. `https://files.gptweb.ru`). Internal client stays on `localhost:9000`.
- Reason: SigV4 binds signature to `Host` header — presigned URL generated with internal endpoint returns `localhost:9000` in body and breaks in browser.
- `FileS3` passes `presignEndpoint` option; if equal/undefined the same client is reused.

### Caddy CORS dedup

- `files.gptweb.ru` Caddyfile block had `header { Access-Control-Allow-* }` AND RustFS adds its own → browsers rejected with "multiple values" error. Removed the Caddy block; RustFS handles CORS alone.

### Presets (75 across 11 categories)

- Migrations `0098_presets.sql` … `0103_user_billing_admin_grant_flag.sql` — preset table + seed + `model_id` rename to recommendation (not hard-bound) + `is_admin_granted` boolean on `user_billing`.
- `params_lock` JSON: `{ aspect_ratio, prompt_prefix, style, ... }` — same `aspect_ratio` field both drives generation params and the masonry card height (`PresetCard.cardAspectRatio()` regex `^(\d+)\s*[:×x/]\s*(\d+)$` → CSS `${m1} / ${m2}`).
- Thumbnails: WebP, \~10-60KB each, generated via sharp inside `lobehub` container (Brevo-style: external host can't write to RustFS path).
- **RustFS gotcha**: never `mkdir -p /data/lobe/presets/` directly on the host filesystem — bare dirs confuse RustFS metadata so subsequent S3 PUTs return AccessDenied. Always go through S3 API.
- `migrations/__drizzle_migrations` SHA256 must match the file hash. If container crashes re-running an applied migration, manually `INSERT` the row with computed hash + `when=<epoch_ms>`.

### Preset UI

- `PresetGrid.tsx` uses CSS columns (`columnCount: isMobile?2:4, columnGap: 12`) for true masonry — CSS Grid couldn't avoid gaps with varied aspect ratios.
- `PresetCard.tsx` is a `<button>` (was `<Block>` — CSS columns broke clicks). Hover overlay has `pointer-events: none`. `CATEGORY_HINTS` map provides per-category usage tips.
- `ActiveGenerationsStrip.tsx` error tiles have a × close button; dismissed IDs persist to `localStorage['wgpt:dismissed-error-tasks']`. (Earlier auto-disappear-after-2min was rejected by user as not visible enough.)
- `FlowMainArea.tsx` (image + video) embeds `<ResourceExplorer/>` inside the "Мои генерации" tab and primes the resource store with the right `FilesTabs` — no navigation hop to `/resource`.

### Payment recovery flow

- `createPayment.returnUrl = /settings/plans?recoveryFor=${payment.id}` (was `/settings/billing?payment=success`).
- `subscription.getPaymentStatus({ id })` query — polled every 1.5s for \~10s on Plans mount when `recoveryFor` param present.
- `subscription.getRecentFailedAttempt` — finds last 24h canceled/failed/pending; drives recovery modal with 3 paths: retry same plan, redeem promo (`promo.redeem.mutate`), open `t.me/gptwebrubot`.
- Recovery modal JSX **lifted outside** the desktop/mobile branch — single `recoveryModal` const used in both renders (was only on desktop, broke on mobile).
- `subscription.removePaymentMethod` — clears `payment_method_id` + sets `auto_renew=false` for YK card-detach UI.

### YooKassa recurring

- `YOOKASSA_RECURRING_ENABLED=0` (env flag) — YK occasionally claims "store can't make recurring payments" 403 despite confirmation; flag lets us flip back to single-payment mode quickly.

### Brevo email gotcha

- Brevo whitelists sending IPs. Sending from outside the `lobe` container box returns 401 "unrecognised IP". Always run from inside the container (or curl from the host's whitelisted IP).

## Phase 14: Promo redeem + broadcast integration (2026-05-17)

### Promo type `broadcast_paid_bonus_24h`

- Расширение `promo.redeem` мутатора (`src/business/server/lambda-routers/promo.ts`).
- Branch активируется когда `promo.type === 'broadcast_paid_bonus_24h'`. Все проверки в одной транзакции (`ctx.serverDB.transaction`):
  1. Lookup recipient: JOIN `broadcast_recipients` + `broadcast_campaigns` WHERE `userId = ctx.userId AND sentAt IS NOT NULL AND promoRedeemedAt IS NULL AND campaigns.promoCode = code AND sentAt > now() - interval '24h'`. ORDER BY sentAt DESC LIMIT 1.
  2. Payment gate (raw SQL via `tx.execute`): `billing_payments WHERE user_id AND status='succeeded' AND amount_rub > 0 AND updated_at > now() - interval '24h'` (нет `succeeded_at` — используем `updated_at`).
  3. Grant credits: `UPDATE user_billing SET token_balance = token_balance + promo.tokenAmount` (это **credits для UI**, не token_limit).
  4. Log: INSERT promo_redemptions (promoId, userId — НЕТ `code` или `source` колонок).
  5. Mark recipient: promo_redeemed_at, bonus_credits_granted, paid_at, payment_id, payment_amount_rub.
  6. Audit event in broadcast_events.
  7. UPDATE promo_codes.used_count++.

### Return shape

Существующая `token_bonus` ветвь возвращает `{message, tokensAdded, type: 'token_bonus' as const}` — НЕ `tokenAmount`. Frontend ожидает именно `tokensAdded`. Новая ветвь матчит шейп.

### Drizzle schema файл

`packages/database/src/schemas/broadcast.ts` — три таблицы (`broadcastCampaigns`, `broadcastRecipients`, `broadcastEvents`). НЕТ `users` import чтобы избежать circular deps (FK существует в SQL, в Drizzle опущен).

### Plans.tsx (broadcast UX)

- `useEffect` на mount читает `?ref=` из URL → авто-заполняет `promoInput` upper-cased + ставит `recoveryDismissed=true` + закрывает recovery modal (чтобы при cookie-failed-payment не лезть с retry-модалкой поверх маркетингового deeplink'а).
- Always-visible `<Card>` "Есть промокод? Введите его" внизу Plans page (раньше промо-input жил ТОЛЬКО внутри recovery modal → 0 redemptions за всю историю).

### Production rollout campaign #2 (2026-05-17)

- 1043 recipients, audience=all, daily_cap=150 → \~7 дней доставки.
- End-to-end verified: token_balance +500, promo_redemptions row, recipient marked, audit event записан. Fake-payment в тесте — INSERT в `billing_payments` со status='succeeded' (потом DELETE по `yookassa_payment_id LIKE 'TEST-%'`).

## Phase 15: Auth Modal + Yandex/Telegram OAuth (2026-05-18)

### UX shift

- Untransited users no longer redirected to `/signin` — root layout wraps `{children}` в `AuthGuardWrapper`, который применяет `filter:blur(8px) + pointer-events:none` к app и рендерит `<AuthGuardOverlay>` (fixed-position modal с tabs Sign Up/Sign In, default = signup).
- Legacy URLs (`/signin /login /signup /register`) → 308 redirect на `/?auth=signin|signup`, сохраняя UTM. Реализовано в начале `betterAuthMiddleware` ДО variants rewrite.
- Middleware redirect для `/signin` нейтрализован для page routes; API/trpc/webapi/oidc routes по-прежнему redirect (без UX impact, это back-end).

### SSO providers

- **Yandex** — новый файл `src/libs/better-auth/sso/providers/yandex.ts` (commit 3c59306bb6). Generic OAuth через Better Auth `genericOAuth`. Использует `getUserInfo()` (НЕ `mapProfileToUser` — mirror Wechat). Env: `AUTH_YANDEX_ID`, `AUTH_YANDEX_SECRET`. Redirect URI registered manually в Yandex OAuth console: `https://ask.gptweb.ru/api/auth/oauth/yandex`. НЕ добавлен в `BUILTIN_BETTER_AUTH_PROVIDERS` (тот массив только для `type: 'builtin'`).
- **Telegram** — уже в upstream (`providers/telegram.ts` — bot deep-link + Redis poll). Env: `AUTH_TELEGRAM_BOT_USERNAME=gptwebrubot` (токен уже был). Bot domain должен быть установлен `@BotFather /setdomain → ask.gptweb.ru`.

### TG auto-link hook (без /settings шага)

- `src/libs/better-auth/hooks/telegram-link.ts` (commit 6e3238a663): `linkTelegramAccount({userId, telegramId, userName, isNewUser})`.
- Wired in `define-config.ts` `databaseHooks.account.create.after` — fires только при `providerId === 'telegram'`.
- Двойная запись:
  1. UPSERT `user_billing.tg_bot_chat_id = <tg_id>` через Drizzle.
  2. POST `http://127.0.0.1:8082/internal/link-user` с `X-Internal-Token` (BOT_INTERNAL_TOKEN).
- Обе записи best-effort, не блокируют auth.

### gptwebrubot side (commit 2508d2d)

- Новый `POST /internal/link-user` в `src/server.ts`, защищён `X-Internal-Token`. UPSERT в обе таблицы bot.db: `tg_chat_id` + `telegram_users`. Отправляет welcome ТОЛЬКО при `source='auth_signup'`.
- Schema gotcha: `tg_chat_id` table использует `updated_at` (epoch ms), НЕ `last_seen_ms`.
- Новый env: `BOT_INTERNAL_TOKEN` (общий секрет с lobechat).

### Frontend components (commits 767f6096b7 + f70c792fc7)

- `src/features/AuthGuard/` — 8 файлов (`AuthGuardOverlay`, `AuthGuardWrapper`, `AuthModal`, `YandexButton`, `TelegramButton`, `EmailSignIn`, `EmailSignUp`, `index.ts`).
- `auth-client.ts` экспортирует named `signIn`/`signUp` напрямую (НЕ `authClient` object). Mirror that.
- `useSearchParams()` из `next/navigation` для tab default — НЕ `useState + useEffect` (правило `@eslint-react/hooks-extra/no-direct-set-state-in-use-effect`).
- `next/link` `Link` вместо `<a>` для internal hrefs (правило `@next/next/no-html-link-for-pages`).
- `AuthGuardOverlay` is `dynamic(ssr: false)` — antd components используют refs.

### Env vars (`/opt/lobechat/.env`)

```
AUTH_YANDEX_ID=<from user>
AUTH_YANDEX_SECRET=<from user>
AUTH_TELEGRAM_BOT_TOKEN=<existing — gptwebrubot>
AUTH_TELEGRAM_BOT_USERNAME=gptwebrubot
BOT_INTERNAL_TOKEN=<openssl rand -hex 32 — общий с gptwebrubot/.env>
BOT_INTERNAL_URL=http://127.0.0.1:8082
```

Все пять также должны быть в `docker-compose.yml` `lobe:` service `environment:`.

### Pitfalls

- Better Auth `databaseHooks.account.create.after` (v1.4.6): `(account, context) => Promise<void>`. `context.context.user.name` НЕ типизировано — cast через `(ctx as any)`.
- `isNewUser` heuristic via `ctx?.context?.newSession?.user == null` — best-effort, только для welcome message dispatch.
- Bot слушает на `127.0.0.1:8082` (Bun), НЕ `:3000`. `BOT_INTERNAL_URL=http://127.0.0.1:8082`.
- Telegram users имеют synthetic email `tg-<id>@telegram.local` — broadcasts to these users undeliverable.
- Yandex redirect URI в OAuth console MUST be added manually (Claude не может).
