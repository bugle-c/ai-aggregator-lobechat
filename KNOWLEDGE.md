# KNOWLEDGE.md — ai-aggregator-lobechat

## Overview

Fork of LobeChat (`lobehub/lobe-chat`) customized for ask.gptweb.ru with YooKassa billing and Russian market support.

**GitHub:** `bugle-c/ai-aggregator-lobechat` (private), branch `canary`
**Upstream:** `lobehub/lobe-chat`, branch `canary`

## Architecture

- **Stack:** Next.js 16 + React 19 + Drizzle ORM + Better Auth + tRPC + antd
- **DB:** ParadeDB/PG17 in Docker (port 5433), database `lobechat`
- **Docker:** 7 containers in `/opt/lobechat/` (VPS #1: 194.113.209.247)
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

## Pitfalls

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
# Open http://194.113.209.247:3300

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

## Env Vars (in /opt/lobechat/.env)

- `YOOKASSA_SHOP_ID` — YooKassa shop ID (empty = billing disabled)
- `YOOKASSA_SECRET_KEY` — YooKassa secret key
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` — AI provider keys (direct, no proxy)
- `OPENROUTER_API_KEY` — empty, not yet configured
