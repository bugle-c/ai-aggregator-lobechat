# KNOWLEDGE.md — ai-aggregator-lobechat

## Overview

Fork of LobeChat (`lobehub/lobe-chat`) customized for ask.gptweb.ru with YooKassa billing and Russian market support.

**GitHub:** `bugle-c/ai-aggregator-lobechat` (private), branch `canary`
**Upstream:** `lobehub/lobe-chat`, branch `canary`

> ### 📰 SEO BLOG — отдельная исчерпывающая инструкция
>
> Вся автоматика SEO-блога gptweb.ru (сбор семантики → кластеры →
> генерация → SEO-gate → публикация → индексация → трекинг трафика →
> реоптимизация → новости) описана пошагово в
> **[`docs/seo_blog_instruction.md`](docs/seo_blog_instruction.md)**.
> **Читай её ПЕРВОЙ перед любым изменением блог-автоматики** (скрипты
> `scripts/blog/*`, таблицы `ai_aggregator.blog_*`, timers `blog-*`).
> Правило: меняешь блог — обновляешь прозу того файла в том же коммите
> (LIVE STATE блок в нём авто-обновляется cron'ом
> `blog-instruction-refresh.timer`, проза — нет).
> 🚫 VPN-тематика запрещена (РКН) — hard-guard в генераторе, не снимать.

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
- **WaveSpeed rate auto-sync ≠ per-second rates (2026-09-23)** — `usage_stats.unit_price` is a per-RUN average; `sync-wavespeed-rates` only overwrites `pricing_unit='image'` rows now (`wavespeed-sync-guard.ts`); per-second (video) rows are reported in the TG summary for manual review. Veo Fast = $0.15/s with audio, Lite = $0.05/s 720p (×1.6 for 1080p in `RESOLUTION_PRICE_FACTORS`).
- **HEIC uploads (2026-09-21)** — browser uploads straight to S3 (presigned), so the only server hook is `file.createFile`; `services/file/heic.ts` re-encodes HEIC→JPEG there (sharp, EXIF rotate). Providers reject `image/heic` outright.
- **Veo 3.1 = 1080p only at 8 s** — WaveSpeed rule, not expressible in param-meta; `business/server/video-generation/normalizeVideoParams.ts` coerces to 720p BEFORE `chargeBeforeGenerate`. Add other "upstream rejects this combo" rules there.
- **Every `*/image-to-video` and `*/edit` card must be `enabled:false` AND paired in `pairedEndpoint.ts`** — a visible unpaired i2v card (was `veo3.1-lite`) yields `field "image" is required` for users without a photo.
- **Customer-facing error text goes through `business/utils/friendlyError.ts`** — never render `error.body` / `body.detail` raw (chat `Conversation/Error`, image `ErrorState`, video `VideoErrorItem`). Raw payload stays in `messages.error` / `async_tasks.error`.
- **ResourceManager view default lives in TWO places** — store (`masonry`) and `Explorer/hooks/useViewMode.ts` `?view=` sync; the hook writes its default into the store on mount, so both must match (was `list` → «Мои генерации» opened as a table).

## Build & Deploy

> **The deploy resets this checkout.** Every push to `canary` ends with `git checkout canary && git reset --hard origin/canary` _in this working tree_ (reflog: \~10 s after the push). Uncommitted edits — docs included — are silently wiped. Commit everything before (or together with) the push; never leave work-in-progress here across a deploy.

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

- **Recommended model follows the donor's (2026-09-19).** The feed labels each item with `model` («Seedance», «GPT Image», «Nanobanana Pro», «Midjourney», «other»; per-id endpoint uses slugs like «nanobanana»). `derive.mapSourceModel` maps by keyword to the card we sell (GPT → `gpt-image-2.5-sunburst`, Midjourney → `midjourney/text-to-image`, Veo → `veo3.1-fast`, Kling → `kling-v3.0-pro`, Wan → `wan-2.7`); unknown → modality default; an i2i style on a model without references (Midjourney) falls back to Nano Banana Pro. Stored in `presets.source_model` (0111). Back-fill of older rows: `scripts/ingestPresets/relabelModels.ts` (images via `/api/images/<id>`, videos by walking the feed). Before this every import was pinned to Seedance Fast / Nano Banana Pro regardless of the original.

- **Video references (2026-09-12, plan п.4).** Seedance 2.0 **Mini and full** take `reference_images` (≤ 9) and `reference_videos` (≤ 3, ≤ 15 s combined) on the _text-to-video_ endpoint; Fast does not. Standard video schema gained `imageUrls`, `videoUrls`, `referenceSeconds`; `resolveVideoEndpoint` swaps to i2v on a START frame only (`imageUrl`), never on `imageUrls`. Billing: the provider bills normalized reference-video seconds at the output rate → `referenceSecondsFor()` (client-measured via `<video>.duration`, each clip ≥ 2 s, ceil, cap 15; videos present but no measurement → 15) is added to `videoSeconds` in quote / precharge / after-charge. UI: `ReferenceImagesUpload` (reuses the image flow's `MultiImagesUpload`) and `ReferenceVideosUpload` (own uploader, `uploadWithProgress` + `skipCheckFileType`) in the video advanced panel; under a text style references stay free, only start/end frames are locked (`styleLockFor(…, 'video')`).

- **Worktree trap (2026-09-12):** `ln -s $MAIN/node_modules` made all 72 workspace links resolve into the MAIN tree, so `packages/*` edits in a worktree were invisible to its `next build`/`tsgo` (prod stayed correct only because the VPS builds from the main checkout). Use `cp -al` for root and per-package `node_modules` (relative links then resolve into the worktree) — recipe in memory `worktree_monorepo_node_modules`.

- **Markup ladder flattened (2026-09-12, owner decision after the pricing audit `docs/superpowers/research/2026-09-12-pricing-audit.md`):** `TIER_MARKUP_MULTIPLIER` cheap ×4 (was 10), mid ×4 (was 5), high ×3 (was 4), premium ×2.5. Effect: gpt-5-mini message 16 → \~6 кр; Seedance Fast 5 s 720p 2400 → 1800 кр; Mini 480p 5 s 900 → 720. `markup_override` per model still wins. Free plan deliberately left at 30 кр/мес (owner: «пока не надо»).

- **Video price by resolution (2026-09-12).** `model_rates.per_unit` for the Seedance 2.0 family is the **720p** price; `RESOLUTION_PRICE_FACTORS` (`compute-cost.ts`, prefix `bytedance/seedance-2.0`) scales it ×0.5 / ×1 / ×2.5 / ×5 for 480p / 720p / 1080p / 4k. `resolution` flows quote → precharge (`params.resolution`) → after-charge (`batch.config.resolution` from the webhook route). Other families stay flat per second. Before this the Fast row carried the 1080p price (0.50, auto-sync drift 06-05) with no factor, so 720p was billed 2.5× cost. Rates SQL: `docs/superpowers/plans/sql/seedance-rates-2026-09-12.sql`.

- **Seedance 2.0 family = one «Качество» switch.** `modelFamilies.ts` groups Mini / Fast / Pro(full); `ModelSettingsChip` renders a `Segmented` next to the model chip when the current model is in a family (switch goes through the same `pick` → lock/upsell, style kept), and a style recommendation inside the same family is not a mismatch. Mini cards added (`…-mini/text-to-video` enabled, `…/image-to-video` paired+hidden); schema now has all 6 aspect ratios + 4k.

- **Intro offer MAGIC48 (2026-09-07):** first payment within 48h of the earned-magic claim → `promo_codes.token_amount` (500, was 1000) bonus credits into the expiring `bonus_balance` pool, 7-day TTL (`intro-offer.ts`, `nextBonusState`: live remainder kept + extended, expired remainder replaced). Banner reads amount/days from `getIntroOfferState`. Amount is changed in the DB, not in code.

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
- `params_lock` JSON: `{ aspect_ratio, duration_sec, ... }` — stored in snake_case, but the runtime schemas (`model-bank/standard-parameters`) declare `aspectRatio`/`duration`. `selectPreset` must therefore translate keys through `features/Generators/normalizePresetParams.ts` (whitelist + alias map); before that helper existed the raw keys were spread into `setParamOnInput` and every curated value was silently dropped. The same `aspect_ratio` field is also read verbatim for the masonry card height (`PresetCard.cardAspectRatio()` regex `^(\d+)\s*[:×x/]\s*(\d+)$` → CSS `${m1} / ${m2}`).
- Thumbnails: WebP, \~10-60KB each, generated via sharp inside `lobehub` container (Brevo-style: external host can't write to RustFS path).
- **RustFS gotcha**: never `mkdir -p /data/lobe/presets/` directly on the host filesystem — bare dirs confuse RustFS metadata so subsequent S3 PUTs return AccessDenied. Always go through S3 API.
- `migrations/__drizzle_migrations` SHA256 must match the file hash. If container crashes re-running an applied migration, manually `INSERT` the row with computed hash + `when=<epoch_ms>`.

### Preset UI

- `PresetGrid.tsx` uses CSS columns (`columnCount: isMobile?2:4, columnGap: 12`) for true masonry — CSS Grid couldn't avoid gaps with varied aspect ratios. _(Superseded: since Ф3 it is a JS masonry, `PresetGallery/MasonryGrid.tsx` + pure `masonryLayout.ts`, heights from `params_lock.aspect_ratio`, absolutely positioned tiles.)_
- **Gallery playback + scroll perf (Ф3c, 2026-09-06).** Owner: «при прокрутке ломается UI, браузер думает». Measured with a real-input Playwright sweep (see commit `perf(presets): hover-debounced media…`): CLS 0.04 per appended page, 137–150 ms long task per page, 45 (desktop) / 114 (mobile) `<video>` mount/unmount cycles per 10 s — each a fresh MP4 fetch + decoder. Rules now live in `features/Generators/previewPlayback.ts` (unit-tested with fake timers): **hover intent** = pointer resting `HOVER_INTENT_MS` _since the last scroll event_ (focus counts at once); **scroll-idle gate** = no new grants until `SCROLL_IDLE_MS` after the last scroll anywhere (one capturing `document` scroll listener), revocations immediate; **sticky grants** = a playing card keeps its slot until `< RELEASE_RATIO` visible, a neighbour needs `≥ ENGAGE_RATIO`, only a hover preempts. Cap (2 desktop / 1 mobile) and revoke-before-grant unchanged. Gotchas found on the way: (1) the «Загрузить ещё» row under the grid was the only CLS source — now sr-only until focused / no IO / fetch error; (2) the paging sentinel sits in a column flexbox that **shrinks an empty 1px item to 0**, and a zero-height IO target at the scrollport edge never intersects → `flexShrink: 0`; (3) with `useDeferredValue(items)` the sentinel is not in the DOM on the render that changes page state, so its observer is on a **callback ref**, not a `useEffect`; (4) `content-visibility: auto` goes on the media box (already `overflow: hidden`, sized by `aspect-ratio`), not on the tile — paint containment on the tile would clip the focus ring / hover lift.
- **Running `next dev` from a worktree** (for perf A/B against prod): Turbopack rejects a `node_modules` symlink pointing outside the project root → `cp -al` (hardlinks, \~10 s) instead of `ln -s`; `--webpack` fails on server deps (`@grpc/grpc-js` → "Can't resolve 'stream'"). Env: `DATABASE_DRIVER=node` (default is the neon WebSocket driver, which cannot reach `127.0.0.1:5433`) and `TEST=1` (disables the `code-inspector` turbopack rule, which binds :5678 and 500s the page when another dev server holds it). Anonymous probes must stub `spend.requiredPlanForModel` (hover prefetch 401 → hard redirect to `?auth=signin`).
- **Generation-config init is page-level (2026-09-06).** `useFetchAiVideoConfig` / `useFetchAiImageConfig` are called from `video/index.tsx` and `image/index.tsx`. Before, their only caller was the legacy `_layout/ConfigPanel`, which the new flow mounted lazily inside the ⚙ drawer — so the first click on «Дополнительные настройки» ran `initialize*Config` on top of a selected style and replaced `model`, `parameters` (incl. prompt + photo) with the remembered model's defaults (owner: «дополнительные настройки ломают все настройки модели»). `initialize*Config` also no-ops (sets `isInit` only) when `currentPreset` is already set — deep link / early click ordering is then irrelevant. Never mount an init hook inside a lazily rendered panel.
- **«Ещё настройки» are an inline disclosure (2026-09-07).** `SettingsStrip` = wrapping chip row → footer (`≈ N кр` left, text button «Ещё настройки ▾» with `aria-expanded` right) → inline panel. No antd `Drawer`, no icon-only gear (owner could not tell it was the entry point), no horizontal scroll (at the sidebar's 288px the video chips were clipped behind the cost). The bindings pass only knobs without a chip; **with a style selected** frame/reference uploaders and exact px dimensions are dropped too (video: resolution / seed / audio / camera; image: size / quality / resolution / steps / cfg / seed). Legacy `_layout/ConfigPanel` is no longer rendered (kept for its exported items).
- **Gallery windowing (2026-09-07).** `MasonryGrid windowed` renders only tiles whose box intersects the scroll host's viewport ± 1000 px (`visibleIndices`, pure, tested); the container keeps its full height, hysteresis of half an overscan between state commits, scroll host = nearest `overflow-y:auto|scroll` ancestor else `window`. `PresetGrid` switches it on above `WINDOW_THRESHOLD = 200` loaded tiles — below that every tile stays mounted (`content-visibility` already skips paint).
- **Hover prefetch = full preset.** `onPresetPrefetch` now also runs `hydratePreset(slug)` (same react-query entry as the click path), so the prompt preview is there the moment a card is picked.
- **`featured` (0110_presets_featured).** Editorial pin for the home rows: `presets.list` takes `featured: true`; `useHomePresets` asks for pinned rows first and fills the rest of the row from the regular ranking, so an empty column changes nothing. Pin by hand: `UPDATE presets SET featured = true WHERE slug IN (...)`. Migration is journal + SQL only (never pre-applied by hand — boot migrator replays it).
- **i2i presets (Ф5b, 2026-09-07).** Image styles with `requires_image` publish like video ones: the image flow shows the «Фото» chip (multi `imageUrls` for nano-banana / single `imageUrl`), the CTA says «Добавьте фото» (`decideGenerateReadiness` now accepts `imageUrls`), and `createImage` refuses without a reference. Runtime needs nothing: `resolveImageEndpoint` routes `…/text-to-image` → `…/edit` when `imageUrls` is set. Ingest no longer queues `requires-image-i2i-pending`; backlog via `activateI2v.ts --modality=image`.
- **A style never hides a knob — it locks it (2026-09-07).** `presetLocks.ts`: `styleLockFor(preset, key)` → `'value'` (pinned via `params_lock`, or width/height when the ratio is pinned) / `'unused'` (reference & frame inputs of a text style; end frame under any style) / `null`. `AdvancedItem lock="reason"` renders the knob greyed with 🔒 + one-line reason. Owner's rule: «всегда видно везде одинаково, но с замочком и объяснением».
- **Model switch keeps the style.** `switchModelKeepingStyle(store.getState, model, provider)` re-applies `params_lock`, the prompt and the photo after `setModelAndProviderOnSelect` resets params; used by the chip's `onPick` and the «Переключить» action. `ModelSettingsChip` marker is about the **selected** model: 🔒 = the selected model itself is behind a higher plan («X доступна с тарифа Y · Тарифы»); ● = differs from the style's recommendation («Стиль рассчитан на X · Переключить», or «Рекомендуемая — X, на тарифе Y · Тарифы»). Always a visible line under the chips, not only a hover tooltip (owner read the old lock-on-current-chip as «Kling залочен»). Lock queries are gated on `isLogin` (authed procedure).
- **Why presets "don't switch" for Pro users:** `bytedance/seedance-2.0-fast/*` in `ai_aggregator.model_rates` has `per_unit=0.50 $/s` (auto-synced 2026-06-05 from WaveSpeed, +2172 % drift, was 0.022) → `classifyTierFromRate` = premium → requires `pro_max`. All 57 t2v presets recommend it. Fix is a data/business decision (`tier_override='high'` or a corrected rate), not UI.
- **FlowSidebar is a scrolling flex column → every slot `flex-shrink: 0` (2026-09-07).** Without it a column taller than the viewport (style card + prompt + open «Ещё настройки») was _shrunk_ by the browser instead of scrolled: the style card's media box collapsed to 0 px and the owner read it as «настройки открылись отдельной страничкой». The CTA is `position: sticky; bottom` inside the scroller. Locked knobs in the advanced panel render as one compact row (name · 🔒 · reason) — the unusable control is not mounted.
- **antd `Popover(Tooltip(Button))` swallows the click.** rc-trigger attaches the Popover's click to the Tooltip _element_, not the DOM button, so `SettingsChip` stopped opening as soon as it had a tooltip — exactly the locked / mismatch model state. Fix: a plain `<span>` between the two triggers (`chipWrap`). Regression test in `SettingsStrip.test.tsx`.
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

## Phase 16: Library lightbox + perf-audit (2026-05-18)

### Perf-audit findings (`/resource`)

Quick TTFB/total measurements via `curl` (anonymous, redirects to login HTML; size 106 KB shell):

- 5 sequential runs: ttfb 234–459 ms, total 408–879 ms. Median \~245/410 ms.
- One outlier (run 4) at 459/879 ms suggests cold caches or a transient backend pause.

Authenticated waterfall не измерен в данном проходе (Playwright OAuth dance ради 1-2 цифр пропустили). Источник медленного first-paint, скорее всего:

1. `useFetchResources` SWR hook (`src/store/file/slices/resource/hooks.ts`) делает `resourceService.queryResources({limit:50, offset:0})` на mount. С `revalidateOnFocus: true` это бьёт каждый раз когда пользователь возвращается во вкладку — лишний request при cmd+tab.
2. `dedupingInterval: 2000ms` короче чем средний навигационный hop, так что повторный заход в /resource всегда тригерит fresh fetch вместо stale-while-revalidate.
3. Lazy-loaded thumbnails (Intersection Observer `rootMargin: 200px`) уже стоят на ImageFileItem и должны помогать на длинных списках.

Если жалобы продолжатся после lightbox-фикса — следующий шаг профилировки: добавить `console.time` на `queryResources` server-side + измерить через `/api/health` ping разницу до и после fetch.

### Lightbox architecture

- Image tiles: **inline antd `<Image preview>`** controlled via `useState` в `ImageFileItem.tsx`. Click на плитке выставляет `previewOpen=true`; antd рендерит lightbox с zoom/rotate/flip/wheel-zoom из коробки. Hover overlay получил `pointer-events:none` чтобы не перехватывать click.
- Video tiles: новый компонент `VideoFileItem.tsx` (mirror of ImageFileItem). `<video preload="metadata" src={url + '#t=0.1'}>` рендерит первый кадр как poster. Maximize-кнопка в углу + центральный Play-индикатор. Клик → локальный antd `<Modal>` с `<video controls autoPlay>`. НЕ идёт через FullscreenModal route.
- Preset cards: `PresetCard.tsx` оставляет existing "click = apply preset" поведение. Новая ZoomIn-кнопка (\~28×28px) в правом верхнем углу открывает `PresetZoomModal` с full-size MP4/image + "Применить пресет" footer-кнопкой. `e.stopPropagation()` + `e.preventDefault()` на zoom-кнопке чтобы не активировать apply. `<span role="button">` обёртка вместо `<button>` — нельзя вкладывать кнопку в кнопку. Keyboard: Enter/Space через `onKeyDown`.
- FullscreenModal route и `FileViewer/Renderer/{Image,Video}` оставлены без изменений — всё ещё используются для PDF/Office/markdown/code файлов через `DefaultFileItem`/`MarkdownFileItem`/`NoteFileItem`.

### Shipped 2026-05-18

- `b760161254` + `2be5327afb` — inline antd `<Image preview open/onOpenChange>` на ImageFileItem (antd 6: deprecated visible/onVisibleChange).
- `0987dd1357` + `0081548035` — новый VideoFileItem с onError-фолбэком и single openModal handler.
- `87ddee220d` + `7d7e1f19db` — dispatcher routes 9 video MIME-типов (mp4/webm/ogg/quicktime/mpeg/avi/mkv/wmv/flv) на VideoFileItem.
- `750a1280a3` + `24b092b0d0` — PresetCard ZoomIn кнопка + PresetZoomModal с keyboard activation.

### Known TODO (follow-up)

- `VIDEO_TYPES` дублируется между `MasonryItem/index.tsx` и `FileViewer/index.tsx` (`VIDEO_MIME_TYPES`). Извлечь в `src/utils/mimeTypes.ts` при следующем касании этой области.
- `isVideoUrl` в `PresetZoomModal.tsx` и обратная image-whitelist логика в `PresetMP4Player.tsx` — общая утилита `isVideoPreset(preset)` чище. Или ориентироваться на `preset.modality === 'video'`.
- iOS Safari может не отрендерить `#t=0.1` poster на `<video>` thumbnail в Library; fallback (`onError` → скрыть `<video>`) оставляет Play-индикатор и Maximize-кнопку видимыми. Если жалобы пойдут — server-side thumbnail generation.

## Phase 17: Audit findings & Board decisions (2026-06-09)

Two-week audit surfaced the following items; documented here so the rationale
survives future rotations of the team.

### P0 — WaveSpeed video billing leak (FIXED `dee3c9178d`)

WaveSpeed webhook handler returned no `usage.durationSeconds`. The route
fell through to ffmpeg-derived duration which can be `0` for short clips;
`chargeAfterGenerate` then early-returned without `writeUsageLog`. Net
effect: user got the video for free, we paid WaveSpeed.

**Fix:** extract `body.input.duration` echo in
`packages/model-runtime/src/providers/wavespeed/video/handleCreateVideoWebhook.ts`
and surface as `usage.durationSeconds`. Type widened in
`packages/model-runtime/src/types/video.ts`.

**Quantified leak:** 5 calls / 14d. 2 seedance-fast t2v on 2026-06-04 by
`rss-print@yandex.ru` — \~2 374 ₽ user-billable, \~675 ₽ our margin. Plus
4 short flux-schnell images at $0.012 total. **Backfill skipped** — op
time + dispute risk exceeds recovered margin. Recurrence is `0` after fix.

### TG-link banner re-enabled (`013e7fd65e`)

`BANNER_TEMPORARILY_DISABLED` flipped from `true` to `false` in
`src/features/TgLinkBonusBanner/useShouldShow.ts`. The original UX concern
(bot-mediated linking confusion) was addressed by tasks #35 + #36 in May.
TG link rate at audit time: 85 / 2602 = **3.3%**, which:

- blocks `payment-recovery-notify` cron from DM'ing failed-checkout users
  (7 / 7 of last 14d failures had no `tg_bot_chat_id`)
- caps broadcast campaign reach to the same 3.3%

### Desktop TG-link card (this commit)

`PcSidebarCard` was already implemented but never mounted. Wired into
`src/app/[variants]/(main)/home/_layout/SidebarContent.tsx` as
`<><PcSidebarCard /><Footer /></>` — sits above the action-icon footer
in the desktop sidebar. Self-gates via `useShouldShow` so anon and
already-linked users see nothing.

### Recovery email subject prefix (this commit)

`src/server/modules/billing/email-templates/recovery.ts` now prefixes
the subject with `[<amount> ₽ · <plan>] ` before the copy line. Stage 1

- Stage 2 emails landed 0 / 7 conversions in the 14d audit window —
  hypothesis is the generic copy line ("Карта стесняется", etc.) reads as
  marketing spam in inbox preview. Concrete price + plan name signals the
  message is theirs. Test cap raised from 60 → 80 chars accordingly.

## Preset platform: ingest + scale (2026-09-06)

Spec: `docs/superpowers/specs/2026-09-06-preset-platform-design.md`.

- **External source (meigen.ai)**: whole domain sits behind a Cloudflare _managed challenge_ — curl,
  headless Chromium and bot UAs all get 403. Only workable channel is a reader proxy:
  `https://r.jina.ai/<url>` with `x-respond-with: text` + `x-no-cache: true` (without no-cache it
  serves a stale body from a _different_ endpoint). Pagination is `?offset=N` step 20 — `?page=` is
  silently ignored and returns page 1 forever. Their media CDN `images.meigen.ai` is **not** challenged:
  `/videos/<id>/video.mp4`, `/videos/<id>/thumb.jpg`, `/tweets/<id>/<n>.jpg` fetch directly.
- **It is not an effects library** — it is a feed of third-party X posts (`title` = truncated prompt,
  `id` = the source tweet snowflake). Attribution is therefore derivable and mandatory:
  `https://x.com/<username>/status/<id>`. `referenceInputContract`/`contentType`/`promptReady` are
  constants in their payload and useless as i2v discriminators — detect reference-image prompts by text.
- **Preview pipeline**: download → `ffmpeg -t 5 -an -vf scale=640:-2 -crf 30 -preset slow -movflags +faststart`
  → RustFS via S3 API (11 MB source ⇒ 77–440 KB). Posters: source `thumb.jpg` → webp.
- **`presets.list` is paginated and slim**: keyset cursor (base64url `{id,k}` where `k` is the sort key),
  and `prompt_template` is deliberately NOT selected — cards use `PresetListItem`, and the click path
  hydrates the full row via `getBySlug` (`usePresetHydrate`) before `selectPreset`. The `?preset=` deep
  link shares that same query through the react-query cache.
  Gotcha: for `sort:'new'` the cursor truncates `ingested_at` to ms in BOTH the ORDER BY and the
  predicate — a µs-precision timestamp compares greater than its own ms cursor and re-serves the row.
- **Search**: `searchable()` in `presets.ts` spans title/description/category/author_name, folds case and
  `ё→е`, and escapes `\ % _` in user input (a typed `%` used to act as a wildcard). Its SQL expression
  must stay textually identical to the indexed expressions in migration `0109_presets_search_trgm.sql`
  or postgres silently seq-scans.
- **Categories come from the DB** (`presets.facets`), not from a hardcoded list — an ingested category
  must never be unreachable in the UI. `PRESET_CATEGORIES.ts` is now only a label map with a
  capitalize-the-slug fallback.
- **Build trap — market-backed sitemaps (2026-09-06):** `app/sitemap.tsx` is `force-static`, and the
  assistants/plugins/models chunk counts came from a live marketplace call at build time (each chunk
  re-fetching upstream). Market returned \~2900 assistant pages → 311 static-export timeouts → build
  `EXIT=1`. Now opt-in: `SITEMAP_INCLUDE_MARKET=1` (default 0 pages; bounded 15s + fallback even when on).
  Also: never start `next build` while another heavy build runs on the host (load \~70 that day).
- There is **no `featured` column**; home ranking uses `sort:'popular'` (`popularity` = source likes).
  Image presets are hand-made with `popularity NULL`, so home images stay on `curated`.
- **Ingest is a cron script, not a route** — `scripts/ingestPresets/` (`npx tsx …/index.ts --dry-run`),
  run by system cron on the host. A run pulls hundreds of MB and shells out to ffmpeg; no Next.js
  `maxDuration` survives that. It reads `.env.local` for DB/S3 and imports only `services/alerts`
  from the app. See `scripts/ingestPresets/README.md` for flags, the crontab line and failure modes.
- **Source-format traps found live in Ф4**: `aspectRatio` is NOT normalised upstream (`427:240`,
  `159:91`, `26:15`, `7:4` are all 16:9), so ratios are snapped to the nearest supported value
  within 3% instead of whitelist-matched; the `/api/images` endpoint ships **no** `aspectRatio` at
  all (resolve from `imageWidth`/`imageHeight`); and not every `id` is an X snowflake — community
  uploads arrive as `community_<uuid>`, for which `/status/<id>` would 404, so attribution (and
  therefore auto-publish) is impossible.
- **Failing a quality rule queues, it never deletes** (`active=false`). Failing the _safety_
  stop-list stores nothing at all. Failing _media_ also stores nothing — `preview_url` is NOT NULL.
  i2v items are ingested with `requires_image=true` but parked in the queue until Ф5 ships the
  model-switch UX; Ф5 flips them on with an UPDATE, not a re-ingest.
- **Labels come from an LLM, not keyword tables** (`scripts/ingestPresets/classify.ts`, since
  2026-09-06). The heuristics mislabelled the first live batch («Портрет: макро» = burger ad,
  «Космос: акварель» = per-uploaded-photo poster that also slipped the i2v regex). One
  `openai/gpt-5-mini` call per item via OpenRouter (`OPENROUTER_API_KEY` in `.env.local`) returns
  `title_ru / summary_ru / category / requires_image / unsafe`; `labeling.ts` merges it over the
  heuristic result (`requires_image` = heuristic OR llm; `unsafe` = safety skip), so `derive.ts` /
  `filters.ts` stay untouched. Guards: no call unless an item survived the free checks, hard cap 60
  calls/run, 20 s timeout, one retry, usage + USD in the run summary (\~$0.0003/item). Gotcha:
  gpt-5-mini needs `reasoning.effort=minimal` or its reasoning eats the whole `max_tokens` and the
  message comes back empty. `--no-llm` = old behaviour; `--relabel[=N]` re-labels stored rows,
  dry-run unless `--apply`.
- **i2v presets (Ф5, 2026-09-06)**: detected by prompt text only (`@image1`, `uploaded photo`,
  `reference face`… — `filters.detectRequiresImage`) → `requires_image=true`, published like any
  row. `recommended_model_id` is the paired **t2v** card `bytedance/seedance-2.0-fast/text-to-video`,
  NOT `…/image-to-video`: every i2v card is `enabled:false` in model-bank (no picker entry, no
  params schema), so `findEnabledModel` would miss it and the Ф3b switch would be `unavailable`
  forever; the wavespeed runtime swaps the endpoint itself when `imageUrl` is set
  (`pairedEndpoint.resolveVideoEndpoint`). The photo lives in the video store's
  `parameters.imageUrl` (the ConfigPanel start-frame param, written by `FrameUpload`). Gating is
  one pure function `features/Generators/presetImageGate.ts` (`decideGenerateReadiness`) shared
  by the desktop CTA, mobile CTA, Enter key and `createVideo`; CTA reads «Добавьте фото»; removing
  the style lifts it. `usePresetModelSwitch` re-applies `imageUrl` after a switch (a switch resets
  params to model defaults). Image (i2i) hits stay queued (`requires-image-i2i-pending`) — no
  image-side gate yet. Pre-Ф5 queued video rows: `scripts/ingestPresets/activateI2v.ts` (dry run;
  `--apply` writes) re-runs current filters and activates only rows that would publish today.
- **Thin categories (2026-09-19):** `--fill=cat,…` + `--fill-min-likes=N` relax only the like floor for
  the listed categories (README «Thin categories»). Whole donor archive walked that day (video feed
  exhausted at 81 pages) → 627 video / 505 image active, every category ≥ 10 except image `landscape`
  (7: donor has no attributed landscapes). `activateI2v` author cap is per run, not global — don't loop it.

## Phase 18: Post-payment path + funnel analytics (2026-09-13, `canary@e7b8db712e`)

Context: `GPTWEB/launch/` (SaaS-playbook run) — 11/24 payers never used the product after paying. Plan: `GPTWEB/tasks/2026-09-13-post-payment-fixes-plan.md`.

- **Real credits-exhausted path:** `checkUsageLimit` throws inside the streaming `webapi/chat/[provider]/route.ts`, error is message-level (`optimisticUpdateMessageError`), NOT `inputSendErrorMsg`. Before this phase users saw a generic 500 + JSON dump; `CreditsExhaustedModal` auto-open in `ChatInput` was dead code. Now: route adds `code:'credits_exhausted'`; `src/business/client/creditsExhausted.ts` + `hooks/useRenderBusinessChatErrorMessageExtra.tsx` render the paywall block, auto-open the modal once per message, fire `paywall_view`, and pass `returnPath`.
- **Subscription checkout returns to the chat:** `CreditsExhaustedModal` passes `returnPath` for subscriptions; global `src/features/PaymentReturn/PaymentReturnHandler.tsx` (mounted in `(main)/_layout`) polls `getPaymentStatus` on `?recoveryFor=` outside `/settings/plans`; success → `SubscriptionActivatedModal` (what the plan unlocks + optional model switch from the enabled list), invalidates `subscription.getBillingState` + whole `spend` router (model locks); failure/timeout → `/settings/plans?recoveryFor=` (existing RecoveryModal). Plans page success toast replaced by the same modal with «back to last topic». Draft prompt is NOT restored on purpose — the message is already persisted in the topic.
- **Monthly counter:** `updatePlan(planId, expiresAt, {resetMonthlyUsage:true})` resets `tokens_used_month=0, month_start=now()` on subscription purchase/upgrade/renewal (fulfill + promo). Lazy reset in `getOrResetUserBilling` is now plan-aware: free → 1st of month, paid → `month_start < now-30d` (avoids double reset).
- **Expiry lifecycle:** cron `GET /api/cron/expiry-reminders` (Bearer `CRON_SECRET`, `/etc/cron.d/lobechat-expiry-reminders`, every 6 h) → `lifecycle/runExpiryReminders.ts`: T-3 email, T0 email + TG DM (bot `/internal/broadcast/send`, MarkdownV2-escaped). Idempotency via `expiry_reminder_sent_at` vs latest `cancelled` event; blocked/deactivated chats count as no channel. In-app `ExpiredPlanBanner` (mounted in `agent/features/Conversation`) via `upsell.getExpiredPlanNotice`, 14-day window, dismiss in localStorage.
- **Metrika goals** (counter 106801684): `paywall_view`, `paywall_click`, `checkout_start` now fire from plans page, TG deeplink (`billing/start` → `CheckoutRedirect.tsx`), UpsellModal, LockedModelUpsellSheet with `source` param; new `payment_success` (612624951) / `payment_failed` (612624952). `reachGoal` accepts a callback.
- **Gotchas:** `YOOKASSA_RECURRING_ENABLED=1` is set in prod (auto-renewal active); `getTestDB` (PGlite) is broken by `migrations/0107_magic_flow.sql` (missing `--> statement-breakpoint`) — integration tests via PGlite fail until fixed; `scripts/lifecycle/expiry-reminder.ts` + its systemd units are redundant now.

## Router-first media via llm-router pool + newcomer Nano Banana default (2026-09-23)

Spec: `docs/superpowers/specs/2026-09-22-router-first-media-routing-design.md`. Module: `src/business/server/media-router/`.

- **What:** eligible Nano Banana images (`google/nano-banana-2/text-to-image`, 1 image, no references, 1:1/16:9/9:16) and Veo 3.1 **Fast/Lite** clips (720p, 4/6/8 s, 16:9|9:16, start frame ok, no references/end frame) are rendered by **our llm-router** (`LLM_ROUTER_URL=http://172.21.0.1:3300`, key `webgpt` in the router's `apiKeys` sqlite) → Google Flow pool. User pays catalog credits; `usage_logs.provider='llm-router'`, `provider_cost_rub=0`. Anything else, and any router failure, → WaveSpeed as before.
- **How:** `client.ts` always uses `async:true` + poll (`GET /v1/videos/generations/<job_id>` is the shared Flow job store; `404 job_not_found` = router restarted → fallback). `breaker.ts` in-memory per kind (3 fails → 15 min; 429 `Retry-After` pauses at once). `budget.ts`: video budget/day from `usage_logs` count + in-flight (`ROUTER_FIRST_VIDEO_DAILY_BUDGET=3`; pool ≈ 70 t2v/month shared with content-farm). Image branch sits in `async/image.ts` before the WaveSpeed submit and feeds the existing `data:`-URI sync path. Video: `lambda/video` hands off to `async/video.ts#createViaRouter`, which polls ≤ 9 min, stores via `processVideoForGeneration({buffer})`, charges `min(actual, requested)` seconds, or falls back to `modelRuntime.createVideo` with the same task/webhook token. `poll-stuck-video-jobs` skips router attempts (`metadata.servedBy`).
- **Newcomer default:** `spend.getCreditState.newcomer` (free plan, ≤ `NEWCOMER_WINDOW_DAYS`=7 since signup, no succeeded payment, `< NEWCOMER_IMAGE_THRESHOLD`=3 images with asset) → `useFetchAiImageConfig` initialises the picker on Nano Banana; not written to `lastSelected`, so it reverts to flux-schnell by itself. `NEWCOMER_IMAGE_MODEL` in `packages/const/src/settings/image.ts`.
- **One free-plan video («Оживить картинку», 2026-09-23 evening):** `media-router/newcomer.ts#getFreeVideoTrial` — free plan gets `FREE_VIDEO_TRIAL_PER_USER`=1 clip; "used" = `async_tasks` of type `video_generation` in pending/processing/success (a failed attempt never consumes it, no column needed). `spend.getCreditState.freeVideo {left, available}`; `requiredPlanForModel` unlocks the pool models (Veo 3.1 Fast/Lite) for free while `left > 0`. Gate in `video/chargeBeforeGenerate`: admits only a pool-eligible request WITH a start frame (`videoRouteFor` + `route.image`) and only when `isRouterVideoAvailable` (flag, breaker, daily budget) — else a Russian sentence before any hold (`FREE_VIDEO_QUEUE_MESSAGE`). Trial clips always go to the pool (`freeTrial` flag through lambda → `async/video.ts`); on pool failure ≤ `ROUTER_FIRST_TRIAL_FALLBACK_PER_DAY` (1) clips/day fall back to WaveSpeed, beyond that the task errors with the queue copy and the hold is refunded. UI: image card action «Оживить картинку» → `/video?animate=<url>` → `useAnimateDeepLink` (Veo 3.1 Fast + start frame + 4 s 720p, param stripped after apply); `PlanGateBanner` shows the trial variant (CTA to the image feed; busy-pool copy when `available=false`). `useVideoGenerate` now surfaces `createVideo` errors (they were swallowed before).
- **Gotchas:** host `ufw` only lets the docker subnet reach ports that have an explicit rule — 3300 needed `ufw allow from 172.16.0.0/12 to any port 3300 proto tcp` (same as the bot's 8082); without it every router call is `fetch failed` → silent WaveSpeed fallback. `user_billing.is_admin_granted` is NOT in the drizzle schema (admin migration only) — plan slug check covers it. Router image renders can take > 60 s when the pool is busy (deadline 90 s, then WaveSpeed). `writeUsageLog.test.ts` has 2 pre-existing failures unrelated to this (markup math).

## EXP-003: Free plan = 5 chat messages per day (2026-09-13, branch `feat/exp003-daily-quota`)

Plan: `GPTWEB/tasks/2026-09-13-exp003-daily-quota-plan.md`. Evidence: L30 — 44/57 activated users burned the 30-credit month in session 1, day-2 return 5.8 %.

- **Gate:** `checkUsageLimit(db, userId, modelId, {kind, countsTowardQuota})` → pure `decideUsageLimit()` (`checkUsageLimit.ts`). Order: (1) monthly pool `token_limit + token_balance + bonus` exhausted → `reason='monthly_cap'` (free, no paid pools) / `'credits'`; (2) free + `kind='chat'`: `count(*) messages WHERE role='user' AND user_id AND created_at >= 00:00 MSK` (`daily-quota.ts`, `FREE_DAILY_MESSAGE_QUOTA=5`, MSK = fixed UTC+3). The count **includes the message being answered** (web `sendMessageInServer` and bot `insertMessage` persist it before the streaming gate) → 5 passes, 6 → `reason='daily_quota'`. **Only purchased credits lift the quota** (owner decision, review 2026-09-13): bypass holds only while `tokensUsedMonth < token_balance + paidBonus` (`paidBonus` = the alive part of `bonus_balance` granted FOR A PAYMENT — MAGIC48 intro offer, derived from its `promo_redemptions` row via `intro-offer.ts#paidBonusFor`, one indexed lookup, `min(activeBonus, token_amount)` within the grant's 7-day window; owner decision 2026-09-14) — the free allowance is NOT part of the bypass budget, prior free usage eats into it (hotfix 2026-09-14: the earlier `token_balance − max(0, used − token_limit)` let a 99 ₽ top-up unlock allowance 2500 + 400 with no daily gate); bonus pools TG-link/referral/MAGIC48 only extend the monthly pool, never the daily gate — otherwise most activated users would never see the experiment. (3) Paid plans, image/video (`kind` passed by both `chargeBeforeGenerate`) and preset/system completions never see the quota: `fetchPresetTaskResult` sends `x-webgpt-task: preset` (`FetchOptions.task`), the route passes `countsTowardQuota=false`. Counting via `messages` (not `usage_logs`) also means topic auto-titles and tool-call follow-up steps don't eat the 5; a failed answer does consume one. Credits/`usage_logs` accounting unchanged.
- **DB:** `ai_aggregator.plans.token_limit` for `free` → **150** (monthly safety cap; code works with 30 too — the daily quota binds first). The bot's zero-credit guard still JOINs the frozen LobeChat `billing_plans` (free=35) → keep that row in sync or bot users hit «Кредиты закончились» at 35. No new index: `messages_created_at_idx` + filter serves the count (EXPLAIN 0.06 ms, 4 buffers).
- **Client:** route body `{code:'credits_exhausted', reason, dailyQuota}`; `creditsExhausted.ts#getCreditsExhaustedReason` → `useRenderBusinessChatErrorMessageExtra` picks `response.CreditsExhausted.{dailyQuota|monthlyCap}.message`, `CreditsExhaustedModal reason='daily_quota'` = «Лимит на сегодня исчерпан» + CTA row «{Стандарт} — 490 ₽/мес, без дневного лимита» / «Пополнить от 99 ₽» / «Подождать до завтра» (+ referral). `paywall_view`/`paywall_click` carry `reason`. `spend.getCreditState` returns `dailyQuota/dailyRemaining/dailyResetAt` (null on paid) → `ChatInput/DailyQuotaCounter` «Осталось сегодня: N из 5».
- **Bot mirror:** `gptwebrubot/src/lobechat/dailyQuota.ts` duplicates the constant + copy; the guard runs BEFORE inserting the user message, so it blocks at `count ≥ 5` (aggregator: `> 5`); `streamChat` parses the refusal body so TG users see the paywall copy instead of `HTTP 500: {json}`; `/plan` and the welcome text say «5 сообщений в день» for free.
- **Not changed (known):** `LowBalanceWarning`/`BalanceBadge`/settings still show monthly credits (150) for free users; `maybeFlagZeroCredits` (zero_credits bot push) fires only on the monthly cap, not on the daily quota; `RuntimeExecutors` (server-side agent runtime) bills but never called `checkUsageLimit` — pre-existing.
