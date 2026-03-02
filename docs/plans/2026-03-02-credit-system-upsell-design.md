# WebGPT Credit System & Upsell Design

## Problem

Current billing has three issues:
1. Users don't know pricing exists (hidden in settings)
2. "Tokens" are meaningless to non-technical users
3. No motivation to upgrade — no upsell triggers, just a hard block when limit hit

## Solution

Replace tokens with credits. Add 4 upsell touchpoints. Redesign plans page.

---

## 1. Credit System

### Unit: 1 credit ~ 1 standard message

Internal mapping (not shown to user):
- 1 credit = ~2,500 tokens (GPT-4o average message cost)
- Image generation = 10 credits
- Video generation = 30 credits
- Heavy reasoning models (o1, etc.) = 3 credits per message

### Pricing Tiers

| Plan | Price | Credits/mo | Hint |
|------|-------|------------|------|
| Start | 0 RUB | 50 | ~50 messages |
| Standard | 490 RUB/mo | 1,000 | ~33 messages/day |
| Pro | 1,490 RUB/mo | 10,000 | ~330 messages/day |

### Top-Up Packages

| Package | Price | Credits |
|---------|-------|---------|
| Mini | 149 RUB | 200 |
| Standard | 599 RUB | 1,000 |
| Maxi | 2,499 RUB | 5,000 |

---

## 2. Upsell Touchpoints (4 locations)

### 2.1 Sidebar Usage Widget (always visible)

Location: Bottom of sidebar, below chat list.

```
+-----------------------------+
| lightning Start: 23/50 cr   |
| progressbar 46%             |
| [Upgrade plan ->]           |
+-----------------------------+
```

- Progress bar: green (<70%), yellow (70-90%), red (>90%)
- Shows current plan name and credit usage
- "Upgrade plan" link -> plans settings page
- For Pro users: stats only, no upgrade button

### 2.2 Low Balance Warning (<20% remaining)

Location: Banner above message input field.

```
+------------------------------------------+
| warning Only 8 credits left         [x]  |
| [Top up] [Upgrade plan]                  |
+------------------------------------------+
```

- Triggers at <20% credits remaining
- Dismissible (x), reappears after 5 messages
- Two CTAs: quick top-up and plan upgrade

### 2.3 Credits Exhausted Modal (0 credits)

Location: Centered modal, closeable.

```
+----------------------------------------------+
|                                          [x]  |
| lightning Credits exhausted                   |
|                                               |
| Your plan Start: 50 credits/mo                |
| Credits reset in 12 days                      |
|                                               |
| +----------+  +----------+                   |
| | Standard |  |   Pro    |                   |
| | 490r/mo  |  | 1490r/mo |                   |
| | 1000 cr  |  | 10000 cr |                   |
| | [Select] |  | [Select] |                   |
| +----------+  +----------+                   |
|                                               |
| or [Top up from 149 RUB]                     |
+----------------------------------------------+
```

- Closeable (x) — not blocking
- Reappears on next message send attempt
- Shows "reset in X days" — motivates either payment or waiting
- Plan cards with upgrade options + quick top-up

### 2.4 Welcome Screen Enhancement

Location: Default new chat screen (currently "Hi, I'm WebGPT").

```
+----------------------------------------------+
| wave Hi! I'm WebGPT                          |
|                                               |
| Plan: Start - 47/50 credits                  |
| progressbar 94%                               |
|                                               |
| bulb Upgrade to Standard for 490 RUB         |
| and get 1,000 credits/month                  |
| [Learn more]                                 |
+----------------------------------------------+
```

- For Free/Basic users: soft upsell with next plan suggestion
- For Pro users: stats only, no upsell
- Non-aggressive, informational

---

## 3. Redesigned Plans Page

Replace current minimal Plans.tsx with comparison layout:

- Three columns: Start / Standard (highlighted "Popular") / Pro
- Credit count + "~X messages" hint per plan
- Feature list per plan (ascending)
- Top-up packages section below
- Current plan badge

---

## 4. Backend Changes

### 4.1 Token-to-Credit Migration

New constant:
```typescript
const TOKENS_PER_CREDIT = 2500;
```

DB schema changes (rename fields):
- `billing_plans.tokenLimit` -> `creditLimit`
- `user_billing.tokenBalance` -> `creditBalance`
- `user_billing.tokensUsedMonth` -> `creditsUsedMonth`
- `billing_payments.tokensAmount` -> `creditsAmount`

Credit deduction per action:
- Text message: `ceil(tokensUsed / TOKENS_PER_CREDIT)` credits
- Image: 10 credits (fixed)
- Video: 30 credits (fixed)

### 4.2 Updated Plan Constants

```typescript
const PLANS = [
  { slug: 'free', name: 'Start', priceRub: 0, creditLimit: 50 },
  { slug: 'basic', name: 'Standard', priceRub: 490, creditLimit: 1000 },
  { slug: 'pro', name: 'Pro', priceRub: 1490, creditLimit: 10000 },
];

const TOPUP_PACKAGES = [
  { amountRub: 149, credits: 200, label: '200 credits' },
  { amountRub: 599, credits: 1000, label: '1,000 credits' },
  { amountRub: 2499, credits: 5000, label: '5,000 credits' },
];
```

### 4.3 New API Endpoint

`spend.getCreditState()` — unified endpoint for all widgets:

```typescript
{
  planName: 'Start',
  creditsUsed: 23,
  creditLimit: 50,
  creditBalance: 0,      // from top-ups
  totalAvailable: 50,
  usagePercent: 46,
  daysUntilReset: 12,
  nextPlanName: 'Standard',
  nextPlanPrice: 490,
  nextPlanCredits: 1000,
}
```

---

## 5. Files to Modify

### Backend
- `packages/database/src/schemas/billing.ts` — rename fields
- `src/server/modules/billing/constants.ts` — new plan/topup values
- `src/server/modules/billing/checkUsageLimit.ts` — credit-based checking
- `src/server/services/billing/index.ts` — credit methods
- `src/business/server/lambda-routers/spend.ts` — getCreditState endpoint
- `src/business/server/lambda-routers/subscription.ts` — update for credits
- `src/business/server/lambda-routers/topUp.ts` — update for credits
- SQL migration script for existing data

### Frontend — New Components
- `src/components/CreditWidget/` — sidebar usage widget
- `src/components/LowBalanceWarning/` — banner above input
- `src/components/CreditsExhaustedModal/` — exhaustion modal

### Frontend — Modified Components
- `src/business/client/BusinessSettingPages/Plans.tsx` — redesign
- `src/business/client/BusinessSettingPages/Usage.tsx` — credits instead of tokens
- `src/business/client/BusinessSettingPages/Funds.tsx` — credits instead of tokens
- `src/app/[variants]/(main)/agent/features/Conversation/AgentWelcome/` — add credit info
- Sidebar layout — add CreditWidget

### i18n
- `src/locales/default/subscription.ts` — update existing limitation keys, add new ones
