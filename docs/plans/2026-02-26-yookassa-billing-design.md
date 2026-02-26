# YooKassa Billing Integration — Design Document

**Date:** 2026-02-26
**Phase:** 3 of LobeChat Migration
**Goal:** Replace LobeChat's stubbed billing system with YooKassa payments for the Russian market.

## Current State

LobeChat's billing is fully stubbed:
- `getSubscriptionPlan()` always returns `Plans.Free`
- All business routers (subscription, spend, topUp) are empty `router({})`
- `chargeBeforeGenerate/chargeAfterGenerate` are no-ops
- Billing UI loads from external iframe (lobechat.com SaaS)
- Old Stripe tables were dropped in migration 0009
- Usage tracking works via message metadata (client-side initiated)

## Architecture

### Database (Drizzle ORM, LobeChat PG on port 5433)

3 new tables via Drizzle migration:

**`billing_plans`** — plan definitions
| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| name | text | "Free", "Basic", "Pro" |
| slug | text UNIQUE | "free", "basic", "pro" |
| price_rub | integer | 0, 490, 1490 |
| token_limit | integer | Monthly limit |
| is_active | boolean | Default true |
| created_at | timestamptz | |

**`billing_payments`** — payment records
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| user_id | text FK(users) | |
| type | text | 'subscription' or 'topup' |
| amount_rub | integer | |
| yookassa_payment_id | text UNIQUE | |
| status | text | 'pending', 'succeeded', 'canceled' |
| plan_id | integer FK? | For subscription type |
| tokens_amount | integer? | For topup type |
| created_at | timestamptz | |

**`user_billing`** — per-user billing state
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| user_id | text UNIQUE FK(users) | |
| plan_id | integer FK(billing_plans) | Default 1 (Free) |
| token_balance | integer | Topup tokens (persistent) |
| tokens_used_month | integer | Resets monthly |
| month_start | date | For lazy reset |
| subscription_expires_at | timestamptz? | 30 days from payment |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### Plans

| Plan | Price | Token Limit/month | Description |
|------|-------|-------------------|-------------|
| Free | 0₽ | 50,000 | Basic models only |
| Basic | 490₽/mo | 500,000 | More models |
| Pro | 1,490₽/mo | 5,000,000 | All models |

### Topup Packages

| Price | Tokens | Value |
|-------|--------|-------|
| 199₽ | 500,000 | Cheapest |
| 699₽ | 2,000,000 | Best value |
| 1,499₽ | 5,000,000 | Max volume |

Topup tokens are persistent (don't expire, don't reset monthly). They're consumed AFTER monthly plan tokens are exhausted.

### Payment Flow

```
User → Billing Page → Click plan/topup
  ↓
tRPC: subscription.createPayment({ type, planId/amount })
  ↓
Backend:
  1. Create payment record (status='pending')
  2. POST api.yookassa.ru/v3/payments (Basic auth)
  3. Store yookassa_payment_id
  4. Return confirmation_url
  ↓
Frontend: window.location.href = paymentUrl
  ↓
User pays in YooKassa UI → returns to /settings/billing?payment=success
  ↓
YooKassa → POST /api/billing/webhook
  ↓
Backend:
  - payment.succeeded → fulfillPayment()
    - subscription: update plan_id + subscription_expires_at
    - topup: add tokens to token_balance
  - payment.canceled → set payment status='canceled'
```

### Limit Enforcement

**Pre-check (before generation):**
1. Query `user_billing` for current month usage
2. Lazy reset: if `month_start < start of current month`, reset `tokens_used_month = 0`
3. Check: `tokens_used_month < plan.token_limit + token_balance`
4. If exceeded → return error, block generation

**Post-track (after generation):**
- LobeChat stores token usage in `messages.metadata` (client-initiated)
- We hook into the message metadata update to increment `user_billing.tokens_used_month`
- When monthly tokens exhausted, deduct from `token_balance`

**Injection points:**
- **Chat:** `src/app/(backend)/webapi/chat/[provider]/route.ts` — before `modelRuntime.chat()`
- **Image:** `src/business/server/image-generation/chargeBeforeGenerate.ts`
- **Video:** `src/business/server/video-generation/chargeBeforeGenerate.ts`

### Files

**New:**
| File | Purpose |
|------|---------|
| `packages/database/src/schemas/billing.ts` | Drizzle schema for 3 tables |
| `src/server/modules/billing/yookassa.ts` | YooKassa HTTP API client |
| `src/server/modules/billing/fulfill.ts` | Payment fulfillment logic |
| `src/server/modules/billing/types.ts` | Billing type definitions |
| `src/server/services/billing/index.ts` | BillingService class (DB queries) |
| `src/app/(backend)/api/billing/webhook/route.ts` | YooKassa webhook handler |
| `src/envs/billing.ts` | Billing environment config |
| Billing UI components | Plan cards, topup packages, payment history |

**Modified:**
| File | Change |
|------|--------|
| `src/business/server/user.ts` | Real `getSubscriptionPlan()` + `initNewUserForBusiness()` |
| `src/business/server/lambda-routers/subscription.ts` | Payment creation, plan queries |
| `src/business/server/lambda-routers/topUp.ts` | Topup payment creation |
| `src/business/server/lambda-routers/spend.ts` | Usage queries |
| `chargeBeforeGenerate.ts` (image + video) | Limit checks |
| `chargeAfterGenerate.ts` (image + video) | Usage tracking |
| `webapi/chat/[provider]/route.ts` | Chat limit check |
| `packages/types/src/subscription.ts` | Update Plans enum |
| `packages/database/src/schemas/index.ts` | Register billing schema |
| `/opt/lobechat/docker-compose.yml` | Custom Docker image |

### Environment Variables

```env
YOOKASSA_SHOP_ID=<shopId>
YOOKASSA_SECRET_KEY=<secretKey>
```

Added via `src/envs/billing.ts` using `@t3-oss/env-nextjs` pattern.

### Docker

Build custom image from fork instead of `lobehub/lobehub`:
- Option A: Build locally on VPS #1 from cloned source
- Option B: GitHub Actions → GHCR → pull on VPS

Recommendation: Build locally (simpler, no CI setup needed, source already cloned).
