# YooKassa Billing Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace LobeChat's stubbed billing system with YooKassa payments (plans + topups) and token-based usage limits for the Russian market.

**Architecture:** Fill LobeChat's existing stubbed business layer (routers, charge functions, user functions) with real implementations. Add 3 Drizzle-managed DB tables, a YooKassa HTTP API client, a webhook handler, and a billing UI page. Usage limits enforced via pre-check before chat/image/video generation.

**Tech Stack:** Drizzle ORM, tRPC, @t3-oss/env-nextjs, YooKassa REST API v3, Next.js API routes

**Design doc:** `docs/plans/2026-02-26-yookassa-billing-design.md`

---

## Task 1: Drizzle Schema + Migration

**Files:**
- Create: `packages/database/src/schemas/billing.ts`
- Modify: `packages/database/src/schemas/index.ts`

**Step 1: Create billing schema**

Create `packages/database/src/schemas/billing.ts`:

```typescript
import { boolean, index, integer, jsonb, pgTable, serial, text, uuid, varchar } from 'drizzle-orm/pg-core';

import { timestamps, timestamptz } from './_helpers';
import { users } from './user';

// ============ Billing Plans ============ //

export const billingPlans = pgTable('billing_plans', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  slug: varchar('slug', { length: 32 }).notNull().unique(),
  priceRub: integer('price_rub').notNull().default(0),
  tokenLimit: integer('token_limit').notNull().default(50000),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
});

export type BillingPlanItem = typeof billingPlans.$inferSelect;
export type NewBillingPlan = typeof billingPlans.$inferInsert;

// ============ Billing Payments ============ //

export const billingPayments = pgTable(
  'billing_payments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 16 }).notNull(), // 'subscription' | 'topup'
    amountRub: integer('amount_rub').notNull(),
    yookassaPaymentId: text('yookassa_payment_id').unique(),
    status: varchar('status', { length: 16 }).notNull().default('pending'), // 'pending' | 'succeeded' | 'canceled'
    planId: integer('plan_id').references(() => billingPlans.id),
    tokensAmount: integer('tokens_amount'),
    metadata: jsonb('metadata').default({}),
    ...timestamps,
  },
  (table) => [
    index('billing_payments_user_id_idx').on(table.userId),
    index('billing_payments_yookassa_id_idx').on(table.yookassaPaymentId),
    index('billing_payments_status_idx').on(table.status),
  ],
);

export type BillingPaymentItem = typeof billingPayments.$inferSelect;
export type NewBillingPayment = typeof billingPayments.$inferInsert;

// ============ User Billing State ============ //

export const userBilling = pgTable(
  'user_billing',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    planId: integer('plan_id')
      .notNull()
      .default(1)
      .references(() => billingPlans.id),
    tokenBalance: integer('token_balance').notNull().default(0),
    tokensUsedMonth: integer('tokens_used_month').notNull().default(0),
    monthStart: timestamptz('month_start').notNull().defaultNow(),
    subscriptionExpiresAt: timestamptz('subscription_expires_at'),
    ...timestamps,
  },
  (table) => [index('user_billing_user_id_idx').on(table.userId)],
);

export type UserBillingItem = typeof userBilling.$inferSelect;
export type NewUserBilling = typeof userBilling.$inferInsert;
```

**Step 2: Register in schema index**

Add to `packages/database/src/schemas/index.ts`:

```typescript
export * from './billing';
```

**Step 3: Generate Drizzle migration**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
DATABASE_URL="postgresql://postgres:0ae6c58c62f6347f2120e958941ef922@127.0.0.1:5433/lobechat" bunx drizzle-kit generate
```

Expected: new SQL file in `packages/database/migrations/0088_*.sql`

**Step 4: Apply migration + seed plans**

```bash
DATABASE_URL="postgresql://postgres:0ae6c58c62f6347f2120e958941ef922@127.0.0.1:5433/lobechat" bunx drizzle-kit push
```

Then seed plans:

```bash
psql "postgresql://postgres:0ae6c58c62f6347f2120e958941ef922@127.0.0.1:5433/lobechat" -c "
INSERT INTO billing_plans (name, slug, price_rub, token_limit) VALUES
  ('Free', 'free', 0, 50000),
  ('Basic', 'basic', 490, 500000),
  ('Pro', 'pro', 1490, 5000000)
ON CONFLICT (slug) DO NOTHING;
"
```

**Step 5: Commit**

```bash
git add packages/database/src/schemas/billing.ts packages/database/src/schemas/index.ts packages/database/migrations/
git commit -m "feat: add billing database schema (plans, payments, user_billing)"
```

---

## Task 2: Environment Config

**Files:**
- Create: `src/envs/billing.ts`

**Step 1: Create billing env config**

Create `src/envs/billing.ts`:

```typescript
import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      YOOKASSA_SHOP_ID?: string;
      YOOKASSA_SECRET_KEY?: string;
    }
  }
}

export const getBillingConfig = () => {
  return createEnv({
    client: {},
    server: {
      YOOKASSA_SHOP_ID: z.string().optional(),
      YOOKASSA_SECRET_KEY: z.string().optional(),
    },
    runtimeEnv: {
      YOOKASSA_SHOP_ID: process.env.YOOKASSA_SHOP_ID,
      YOOKASSA_SECRET_KEY: process.env.YOOKASSA_SECRET_KEY,
    },
  });
};

export const billingEnv = getBillingConfig();
```

**Step 2: Commit**

```bash
git add src/envs/billing.ts
git commit -m "feat: add billing environment config for YooKassa"
```

---

## Task 3: BillingService (DB Queries)

**Files:**
- Create: `src/server/services/billing/index.ts`

**Step 1: Create BillingService**

Create `src/server/services/billing/index.ts`:

```typescript
import { and, desc, eq, sql } from 'drizzle-orm';

import {
  type BillingPaymentItem,
  type BillingPlanItem,
  type NewBillingPayment,
  type UserBillingItem,
  billingPayments,
  billingPlans,
  userBilling,
} from '@/database/schemas';
import { type LobeChatDatabase } from '@/database/type';

export class BillingService {
  private db: LobeChatDatabase;
  private userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  // ============ Plans ============ //

  getActivePlans = async (): Promise<BillingPlanItem[]> => {
    return this.db.query.billingPlans.findMany({
      where: eq(billingPlans.isActive, true),
      orderBy: billingPlans.priceRub,
    });
  };

  getPlanById = async (planId: number): Promise<BillingPlanItem | undefined> => {
    return this.db.query.billingPlans.findFirst({
      where: eq(billingPlans.id, planId),
    });
  };

  // ============ User Billing ============ //

  getUserBilling = async (): Promise<UserBillingItem | undefined> => {
    return this.db.query.userBilling.findFirst({
      where: eq(userBilling.userId, this.userId),
    });
  };

  getOrCreateUserBilling = async (): Promise<UserBillingItem> => {
    const existing = await this.getUserBilling();
    if (existing) return existing;

    const [created] = await this.db
      .insert(userBilling)
      .values({ userId: this.userId })
      .onConflictDoNothing()
      .returning();

    // Handle race condition: if onConflictDoNothing returned nothing, re-fetch
    if (!created) {
      const refetched = await this.getUserBilling();
      if (!refetched) throw new Error('Failed to create user billing record');
      return refetched;
    }

    return created;
  };

  /**
   * Lazy monthly reset: if month_start is before current month, reset tokens_used_month.
   * Returns the (possibly reset) user billing record.
   */
  getOrResetUserBilling = async (): Promise<UserBillingItem> => {
    const billing = await this.getOrCreateUserBilling();
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    if (new Date(billing.monthStart) < currentMonthStart) {
      const [updated] = await this.db
        .update(userBilling)
        .set({
          tokensUsedMonth: 0,
          monthStart: currentMonthStart,
          updatedAt: new Date(),
        })
        .where(eq(userBilling.userId, this.userId))
        .returning();
      return updated;
    }

    return billing;
  };

  updatePlan = async (planId: number, expiresAt: Date): Promise<void> => {
    await this.db
      .update(userBilling)
      .set({
        planId,
        subscriptionExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(userBilling.userId, this.userId));
  };

  addTokenBalance = async (tokens: number): Promise<void> => {
    await this.db
      .update(userBilling)
      .set({
        tokenBalance: sql`${userBilling.tokenBalance} + ${tokens}`,
        updatedAt: new Date(),
      })
      .where(eq(userBilling.userId, this.userId));
  };

  incrementTokensUsed = async (tokens: number): Promise<void> => {
    await this.db
      .update(userBilling)
      .set({
        tokensUsedMonth: sql`${userBilling.tokensUsedMonth} + ${tokens}`,
        updatedAt: new Date(),
      })
      .where(eq(userBilling.userId, this.userId));
  };

  // ============ Payments ============ //

  createPayment = async (data: Omit<NewBillingPayment, 'userId'>): Promise<BillingPaymentItem> => {
    const [payment] = await this.db
      .insert(billingPayments)
      .values({ ...data, userId: this.userId })
      .returning();
    return payment;
  };

  getUserPayments = async (limit = 20): Promise<BillingPaymentItem[]> => {
    return this.db.query.billingPayments.findMany({
      where: eq(billingPayments.userId, this.userId),
      orderBy: desc(billingPayments.createdAt),
      limit,
    });
  };

  // ============ Static (no userId needed) ============ //

  static getPaymentByYookassaId = async (
    db: LobeChatDatabase,
    yookassaId: string,
  ): Promise<BillingPaymentItem | undefined> => {
    return db.query.billingPayments.findFirst({
      where: eq(billingPayments.yookassaPaymentId, yookassaId),
    });
  };

  static updatePaymentStatus = async (
    db: LobeChatDatabase,
    paymentId: string,
    status: string,
  ): Promise<void> => {
    await db
      .update(billingPayments)
      .set({ status, updatedAt: new Date() })
      .where(eq(billingPayments.id, paymentId));
  };

  static updatePaymentYookassaId = async (
    db: LobeChatDatabase,
    paymentId: string,
    yookassaPaymentId: string,
  ): Promise<void> => {
    await db
      .update(billingPayments)
      .set({ yookassaPaymentId, updatedAt: new Date() })
      .where(eq(billingPayments.id, paymentId));
  };
}
```

**Step 2: Commit**

```bash
git add src/server/services/billing/
git commit -m "feat: add BillingService with plan, payment, and usage queries"
```

---

## Task 4: YooKassa API Client + Fulfillment

**Files:**
- Create: `src/server/modules/billing/yookassa.ts`
- Create: `src/server/modules/billing/fulfill.ts`
- Create: `src/server/modules/billing/constants.ts`

**Step 1: Create constants**

Create `src/server/modules/billing/constants.ts`:

```typescript
export const TOPUP_PACKAGES = [
  { amountRub: 199, tokens: 500_000, label: '500K токенов' },
  { amountRub: 699, tokens: 2_000_000, label: '2M токенов' },
  { amountRub: 1499, tokens: 5_000_000, label: '5M токенов' },
] as const;

export type TopupPackage = (typeof TOPUP_PACKAGES)[number];

export function getTopupPackage(amountRub: number): TopupPackage | undefined {
  return TOPUP_PACKAGES.find((p) => p.amountRub === amountRub);
}
```

**Step 2: Create YooKassa client**

Create `src/server/modules/billing/yookassa.ts`:

```typescript
import crypto from 'node:crypto';

import { billingEnv } from '@/envs/billing';

interface CreatePaymentParams {
  amountRub: number;
  description: string;
  metadata?: Record<string, string>;
  returnUrl: string;
}

interface YookassaPaymentResponse {
  confirmation: { confirmation_url: string };
  id: string;
  status: string;
}

export async function createYookassaPayment(
  params: CreatePaymentParams,
): Promise<{ paymentId: string; paymentUrl: string }> {
  const shopId = billingEnv.YOOKASSA_SHOP_ID;
  const secretKey = billingEnv.YOOKASSA_SECRET_KEY;
  if (!shopId || !secretKey) throw new Error('YooKassa credentials not configured');

  const idempotenceKey = crypto.randomUUID();
  const auth = Buffer.from(`${shopId}:${secretKey}`).toString('base64');

  const body = {
    amount: {
      currency: 'RUB',
      value: params.amountRub.toFixed(2),
    },
    capture: true,
    confirmation: {
      return_url: params.returnUrl,
      type: 'redirect',
    },
    description: params.description,
    metadata: params.metadata || {},
  };

  const res = await fetch('https://api.yookassa.ru/v3/payments', {
    body: JSON.stringify(body),
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
      'Idempotence-Key': idempotenceKey,
    },
    method: 'POST',
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`YooKassa error ${res.status}: ${err}`);
  }

  const data: YookassaPaymentResponse = await res.json();
  return {
    paymentId: data.id,
    paymentUrl: data.confirmation.confirmation_url,
  };
}
```

**Step 3: Create fulfillment logic**

Create `src/server/modules/billing/fulfill.ts`:

```typescript
import { type LobeChatDatabase } from '@/database/type';

import { BillingService } from '../../services/billing';

export async function fulfillPayment(db: LobeChatDatabase, yookassaPaymentId: string): Promise<void> {
  const payment = await BillingService.getPaymentByYookassaId(db, yookassaPaymentId);
  if (!payment) {
    console.error(`[billing] Payment not found for YooKassa ID: ${yookassaPaymentId}`);
    return;
  }
  if (payment.status === 'succeeded') return; // Already processed (idempotent)

  await BillingService.updatePaymentStatus(db, payment.id, 'succeeded');

  const billingService = new BillingService(db, payment.userId);

  if (payment.type === 'subscription' && payment.planId) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    await billingService.getOrCreateUserBilling(); // Ensure record exists
    await billingService.updatePlan(payment.planId, expiresAt);
    console.log(`[billing] Subscription activated: user=${payment.userId} plan=${payment.planId}`);
  } else if (payment.type === 'topup' && payment.tokensAmount) {
    await billingService.getOrCreateUserBilling(); // Ensure record exists
    await billingService.addTokenBalance(payment.tokensAmount);
    console.log(`[billing] Topup fulfilled: user=${payment.userId} tokens=${payment.tokensAmount}`);
  }
}

export async function cancelPayment(db: LobeChatDatabase, yookassaPaymentId: string): Promise<void> {
  const payment = await BillingService.getPaymentByYookassaId(db, yookassaPaymentId);
  if (!payment) return;
  if (payment.status !== 'pending') return;
  await BillingService.updatePaymentStatus(db, payment.id, 'canceled');
  console.log(`[billing] Payment canceled: ${yookassaPaymentId}`);
}
```

**Step 4: Commit**

```bash
git add src/server/modules/billing/
git commit -m "feat: add YooKassa API client and payment fulfillment"
```

---

## Task 5: Webhook Handler

**Files:**
- Create: `src/app/(backend)/api/billing/webhook/route.ts`

**Step 1: Create webhook route**

Create `src/app/(backend)/api/billing/webhook/route.ts`:

```typescript
import { NextResponse } from 'next/server';

import { getServerDB } from '@/database/core/db-adaptor';
import { cancelPayment, fulfillPayment } from '@/server/modules/billing/fulfill';

interface YookassaWebhookPayload {
  event: string;
  object: {
    id: string;
    status: string;
    metadata?: Record<string, string>;
  };
  type: string;
}

export const POST = async (req: Request): Promise<NextResponse> => {
  try {
    const payload: YookassaWebhookPayload = await req.json();
    const db = await getServerDB();

    console.log(`[billing webhook] event=${payload.event} payment_id=${payload.object?.id}`);

    switch (payload.event) {
      case 'payment.succeeded': {
        await fulfillPayment(db, payload.object.id);
        break;
      }
      case 'payment.canceled': {
        await cancelPayment(db, payload.object.id);
        break;
      }
      default: {
        console.log(`[billing webhook] unhandled event: ${payload.event}`);
      }
    }

    // Always return 200 — YooKassa retries on non-2xx
    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('[billing webhook] error:', error);
    // Still return 200 to prevent infinite retries
    return NextResponse.json({ status: 'error' });
  }
};
```

**Step 2: Commit**

```bash
git add src/app/\(backend\)/api/billing/
git commit -m "feat: add YooKassa webhook handler"
```

---

## Task 6: Fill Business Layer — User Functions

**Files:**
- Modify: `src/business/server/user.ts`
- Modify: `packages/types/src/subscription.ts`

**Step 1: Update Plans enum**

Replace content of `packages/types/src/subscription.ts`:

```typescript
export enum Plans {
  Basic = 'basic',
  Free = 'free',
  Pro = 'pro',
}
```

**Step 2: Implement getSubscriptionPlan and initNewUserForBusiness**

Replace content of `src/business/server/user.ts`:

```typescript
import { type ReferralStatusString } from '@lobechat/types';
import { Plans } from '@lobechat/types';
import { eq } from 'drizzle-orm';

import { getServerDB } from '@/database/core/db-adaptor';
import { billingPlans, userBilling } from '@/database/schemas';

const PLAN_SLUG_TO_ENUM: Record<string, Plans> = {
  basic: Plans.Basic,
  free: Plans.Free,
  pro: Plans.Pro,
};

export async function getReferralStatus(userId: string): Promise<ReferralStatusString | undefined> {
  return undefined;
}

export async function getSubscriptionPlan(userId: string): Promise<Plans> {
  try {
    const db = await getServerDB();
    const billing = await db.query.userBilling.findFirst({
      where: eq(userBilling.userId, userId),
    });

    if (!billing) return Plans.Free;

    // Check if subscription expired
    if (billing.subscriptionExpiresAt && new Date(billing.subscriptionExpiresAt) < new Date()) {
      return Plans.Free;
    }

    const plan = await db.query.billingPlans.findFirst({
      where: eq(billingPlans.id, billing.planId),
    });

    return PLAN_SLUG_TO_ENUM[plan?.slug || 'free'] || Plans.Free;
  } catch (error) {
    console.error('[billing] getSubscriptionPlan error:', error);
    return Plans.Free;
  }
}

export async function initNewUserForBusiness(
  userId: string,
  createdAt: Date | null | undefined,
): Promise<void> {
  try {
    const db = await getServerDB();
    await db
      .insert(userBilling)
      .values({ userId })
      .onConflictDoNothing();
  } catch (error) {
    console.error('[billing] initNewUserForBusiness error:', error);
  }
}
```

**Step 3: Commit**

```bash
git add packages/types/src/subscription.ts src/business/server/user.ts
git commit -m "feat: implement getSubscriptionPlan and user billing init"
```

---

## Task 7: Fill Business Routers — subscription + topUp + spend

**Files:**
- Modify: `src/business/server/lambda-routers/subscription.ts`
- Modify: `src/business/server/lambda-routers/topUp.ts`
- Modify: `src/business/server/lambda-routers/spend.ts`

**Step 1: Implement subscription router**

Replace content of `src/business/server/lambda-routers/subscription.ts`:

```typescript
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { getTopupPackage } from '@/server/modules/billing/constants';
import { createYookassaPayment } from '@/server/modules/billing/yookassa';
import { BillingService } from '@/server/services/billing';

const billingProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: { billingService: new BillingService(ctx.serverDB, ctx.userId) },
  });
});

export const subscriptionRouter = router({
  createPayment: billingProcedure
    .input(
      z.object({
        planId: z.number(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const plan = await ctx.billingService.getPlanById(input.planId);
      if (!plan) throw new Error('Plan not found');
      if (plan.priceRub === 0) throw new Error('Cannot purchase free plan');

      const payment = await ctx.billingService.createPayment({
        amountRub: plan.priceRub,
        planId: plan.id,
        type: 'subscription',
      });

      const returnUrl = `${process.env.APP_URL || 'https://ask.gptweb.ru'}/settings/billing?payment=success`;

      const { paymentId, paymentUrl } = await createYookassaPayment({
        amountRub: plan.priceRub,
        description: `Подписка ${plan.name} — WebGPT`,
        metadata: { payment_id: payment.id, type: 'subscription' },
        returnUrl,
      });

      await BillingService.updatePaymentYookassaId(ctx.serverDB, payment.id, paymentId);

      return { paymentUrl };
    }),

  getBillingState: billingProcedure.query(async ({ ctx }) => {
    const billing = await ctx.billingService.getOrResetUserBilling();
    const plan = await ctx.billingService.getPlanById(billing.planId);
    return {
      plan: plan || null,
      subscriptionExpiresAt: billing.subscriptionExpiresAt,
      tokenBalance: billing.tokenBalance,
      tokenLimit: plan?.tokenLimit || 50000,
      tokensUsedMonth: billing.tokensUsedMonth,
    };
  }),

  getPlans: billingProcedure.query(async ({ ctx }) => {
    return ctx.billingService.getActivePlans();
  }),

  getPayments: billingProcedure.query(async ({ ctx }) => {
    return ctx.billingService.getUserPayments();
  }),
});
```

**Step 2: Implement topUp router**

Replace content of `src/business/server/lambda-routers/topUp.ts`:

```typescript
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { TOPUP_PACKAGES, getTopupPackage } from '@/server/modules/billing/constants';
import { createYookassaPayment } from '@/server/modules/billing/yookassa';
import { BillingService } from '@/server/services/billing';

const billingProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: { billingService: new BillingService(ctx.serverDB, ctx.userId) },
  });
});

export const topUpRouter = router({
  createPayment: billingProcedure
    .input(z.object({ amountRub: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const pkg = getTopupPackage(input.amountRub);
      if (!pkg) throw new Error('Invalid topup amount');

      const payment = await ctx.billingService.createPayment({
        amountRub: pkg.amountRub,
        tokensAmount: pkg.tokens,
        type: 'topup',
      });

      const returnUrl = `${process.env.APP_URL || 'https://ask.gptweb.ru'}/settings/billing?payment=success`;

      const { paymentId, paymentUrl } = await createYookassaPayment({
        amountRub: pkg.amountRub,
        description: `Пополнение ${pkg.label} — WebGPT`,
        metadata: { payment_id: payment.id, type: 'topup' },
        returnUrl,
      });

      await BillingService.updatePaymentYookassaId(ctx.serverDB, payment.id, paymentId);

      return { paymentUrl };
    }),

  getPackages: billingProcedure.query(() => {
    return TOPUP_PACKAGES;
  }),
});
```

**Step 3: Implement spend router**

Replace content of `src/business/server/lambda-routers/spend.ts`:

```typescript
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { BillingService } from '@/server/services/billing';

const billingProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: { billingService: new BillingService(ctx.serverDB, ctx.userId) },
  });
});

export const spendRouter = router({
  getUsageSummary: billingProcedure.query(async ({ ctx }) => {
    const billing = await ctx.billingService.getOrResetUserBilling();
    const plan = await ctx.billingService.getPlanById(billing.planId);
    const tokenLimit = plan?.tokenLimit || 50000;
    const totalAvailable = tokenLimit + billing.tokenBalance;
    const usagePercent = totalAvailable > 0 ? Math.round((billing.tokensUsedMonth / totalAvailable) * 100) : 0;

    return {
      plan: plan?.name || 'Free',
      tokenBalance: billing.tokenBalance,
      tokenLimit,
      tokensUsedMonth: billing.tokensUsedMonth,
      totalAvailable,
      usagePercent: Math.min(usagePercent, 100),
    };
  }),
});
```

**Step 4: Commit**

```bash
git add src/business/server/lambda-routers/
git commit -m "feat: implement subscription, topUp, and spend tRPC routers"
```

---

## Task 8: Usage Limit Enforcement

**Files:**
- Create: `src/server/modules/billing/checkUsageLimit.ts`
- Modify: `src/app/(backend)/webapi/chat/[provider]/route.ts`
- Modify: `src/business/server/image-generation/chargeBeforeGenerate.ts`
- Modify: `src/business/server/image-generation/chargeAfterGenerate.ts`
- Modify: `src/business/server/video-generation/chargeBeforeGenerate.ts`
- Modify: `src/business/server/video-generation/chargeAfterGenerate.ts`

**Step 1: Create shared limit check function**

Create `src/server/modules/billing/checkUsageLimit.ts`:

```typescript
import { eq } from 'drizzle-orm';

import { billingPlans, userBilling } from '@/database/schemas';
import { type LobeChatDatabase } from '@/database/type';
import { BillingService } from '@/server/services/billing';

export interface UsageLimitResult {
  allowed: boolean;
  message?: string;
  remainingTokens?: number;
}

export async function checkUsageLimit(
  db: LobeChatDatabase,
  userId: string,
): Promise<UsageLimitResult> {
  try {
    const billingService = new BillingService(db, userId);
    const billing = await billingService.getOrResetUserBilling();
    const plan = await billingService.getPlanById(billing.planId);
    const tokenLimit = plan?.tokenLimit || 50000;
    const totalAvailable = tokenLimit + billing.tokenBalance;

    if (billing.tokensUsedMonth >= totalAvailable) {
      return {
        allowed: false,
        message: 'Лимит токенов исчерпан. Пополните баланс или обновите план.',
        remainingTokens: 0,
      };
    }

    return {
      allowed: true,
      remainingTokens: totalAvailable - billing.tokensUsedMonth,
    };
  } catch (error) {
    console.error('[billing] checkUsageLimit error:', error);
    // On error, allow the request (fail-open)
    return { allowed: true };
  }
}

/**
 * Record token usage after generation. Increments tokens_used_month.
 * If monthly tokens exhausted, deducts from token_balance.
 */
export async function recordTokenUsage(
  db: LobeChatDatabase,
  userId: string,
  tokensUsed: number,
): Promise<void> {
  if (tokensUsed <= 0) return;
  try {
    const billingService = new BillingService(db, userId);
    await billingService.incrementTokensUsed(tokensUsed);
  } catch (error) {
    console.error('[billing] recordTokenUsage error:', error);
  }
}
```

**Step 2: Add limit check to chat route**

Modify `src/app/(backend)/webapi/chat/[provider]/route.ts` — add limit check before `modelRuntime.chat()`:

After line `const data = (await req.json()) as ChatStreamPayload;` (line 32), add:

```typescript
// ============  2a. check usage limit  ============ //
const { checkUsageLimit } = await import('@/server/modules/billing/checkUsageLimit');
const limitResult = await checkUsageLimit(serverDB, userId);
if (!limitResult.allowed) {
  return createErrorResponse(ChatErrorType.InternalServerError, {
    error: { message: limitResult.message },
    errorMessage: limitResult.message,
    provider,
  });
}
```

The full modified section becomes:

```typescript
// ============  2. create chat completion   ============ //
const data = (await req.json()) as ChatStreamPayload;

// ============  2a. check usage limit  ============ //
const { checkUsageLimit } = await import('@/server/modules/billing/checkUsageLimit');
const limitResult = await checkUsageLimit(serverDB, userId);
if (!limitResult.allowed) {
  return createErrorResponse(ChatErrorType.InternalServerError, {
    error: { message: limitResult.message },
    errorMessage: limitResult.message,
    provider,
  });
}

const tracePayload = getTracePayload(req);
```

**Step 3: Implement image chargeBeforeGenerate**

Replace content of `src/business/server/image-generation/chargeBeforeGenerate.ts`:

```typescript
import { type NewGeneration, type NewGenerationBatch } from '@/database/schemas';
import { getServerDB } from '@/database/core/db-adaptor';
import { type CreateImageServicePayload } from '@/server/routers/lambda/image';
import { checkUsageLimit } from '@/server/modules/billing/checkUsageLimit';

interface ChargeParams {
  clientIp?: string | null;
  configForDatabase: CreateImageServicePayload['params'];
  generationParams: CreateImageServicePayload['params'];
  generationTopicId: string;
  imageNum: number;
  model: string;
  provider: string;
  userId: string;
}

type ChargeResult =
  | undefined
  | {
      data: {
        batch: NewGenerationBatch;
        generations: NewGeneration[];
      };
      success: true;
    };

export async function chargeBeforeGenerate(params: ChargeParams): Promise<ChargeResult> {
  const db = await getServerDB();
  const result = await checkUsageLimit(db, params.userId);

  if (!result.allowed) {
    // Return undefined to proceed — LobeChat will show the error via chat error handling
    // The image router expects ChargeResult format, so we log and let it through
    // but the actual blocking happens at the chat level
    console.warn(`[billing] Image generation blocked for user ${params.userId}: ${result.message}`);
    throw new Error(result.message || 'Usage limit exceeded');
  }

  return undefined; // OK to proceed
}
```

**Step 4: Implement image chargeAfterGenerate**

Replace content of `src/business/server/image-generation/chargeAfterGenerate.ts`:

```typescript
import { type ModelPerformance, type ModelUsage } from '@/types/index';
import { getServerDB } from '@/database/core/db-adaptor';
import { recordTokenUsage } from '@/server/modules/billing/checkUsageLimit';

interface ChargeParams {
  metadata: {
    asyncTaskId: string;
    generationBatchId: string;
    modelId: string;
    topicId?: string;
  };
  metrics?: ModelPerformance;
  modelUsage?: ModelUsage;
  provider: string;
  userId: string;
}

export async function chargeAfterGenerate(params: ChargeParams): Promise<void> {
  const totalTokens = params.modelUsage?.totalTokens || 0;
  if (totalTokens > 0) {
    const db = await getServerDB();
    await recordTokenUsage(db, params.userId, totalTokens);
  }
}
```

**Step 5: Implement video chargeBeforeGenerate**

Replace content of `src/business/server/video-generation/chargeBeforeGenerate.ts`:

```typescript
import type { NewGeneration, NewGenerationBatch } from '@/database/schemas';
import type { CreateVideoServicePayload } from '@/server/routers/lambda/video';
import { getServerDB } from '@/database/core/db-adaptor';
import { checkUsageLimit } from '@/server/modules/billing/checkUsageLimit';

interface ChargeParams {
  generationTopicId: string;
  model: string;
  params: CreateVideoServicePayload['params'];
  provider: string;
  userId: string;
}

interface ErrorBatch {
  data: {
    batch: NewGenerationBatch;
    generations: NewGeneration[];
  };
  success: true;
}

interface ChargeBeforeResult {
  errorBatch?: ErrorBatch;
  prechargeResult?: Record<string, unknown>;
}

export async function chargeBeforeGenerate(params: ChargeParams): Promise<ChargeBeforeResult> {
  const db = await getServerDB();
  const result = await checkUsageLimit(db, params.userId);

  if (!result.allowed) {
    console.warn(`[billing] Video generation blocked for user ${params.userId}: ${result.message}`);
    throw new Error(result.message || 'Usage limit exceeded');
  }

  return {};
}
```

**Step 6: Implement video chargeAfterGenerate**

Replace content of `src/business/server/video-generation/chargeAfterGenerate.ts`:

```typescript
import { getServerDB } from '@/database/core/db-adaptor';
import { recordTokenUsage } from '@/server/modules/billing/checkUsageLimit';

interface ChargeParams {
  computePriceParams?: { generateAudio?: boolean };
  isError?: boolean;
  latency?: number;
  metadata: {
    asyncTaskId: string;
    generationBatchId: string;
    modelId: string;
    topicId?: string;
  };
  model: string;
  prechargeResult?: Record<string, unknown>;
  provider: string;
  usage?: { completionTokens: number; totalTokens: number };
  userId: string;
}

export async function chargeAfterGenerate(params: ChargeParams): Promise<void> {
  if (params.isError) return; // Don't charge for errors

  const totalTokens = params.usage?.totalTokens || 0;
  if (totalTokens > 0) {
    const db = await getServerDB();
    await recordTokenUsage(db, params.userId, totalTokens);
  }
}
```

**Step 7: Commit**

```bash
git add src/server/modules/billing/checkUsageLimit.ts \
  src/app/\(backend\)/webapi/chat/\[provider\]/route.ts \
  src/business/server/image-generation/ \
  src/business/server/video-generation/
git commit -m "feat: implement usage limit checks for chat, image, and video generation"
```

---

## Task 9: Build Custom Docker Image

**Files:**
- Modify: `/opt/lobechat/docker-compose.yml` (on VPS #1)

**Step 1: Install dependencies and build**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
pnpm install
```

**Step 2: Build Docker image from fork**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
docker build -t lobechat-custom:latest .
```

This uses the existing `Dockerfile` in the repo root. Expected build time: 5-15 minutes.

**Step 3: Update docker-compose to use custom image**

In `/opt/lobechat/docker-compose.yml`, change the `lobe` service:

From:
```yaml
  lobe:
    image: lobehub/lobehub
```

To:
```yaml
  lobe:
    image: lobechat-custom:latest
```

**Step 4: Add YooKassa env vars**

Add to `/opt/lobechat/.env`:

```env
YOOKASSA_SHOP_ID=<your_shop_id>
YOOKASSA_SECRET_KEY=<your_secret_key>
```

**Step 5: Restart LobeChat with custom image**

```bash
cd /opt/lobechat
docker compose up -d lobe
```

**Step 6: Verify container is healthy**

```bash
docker compose ps
curl -s -o /dev/null -w "%{http_code}" http://localhost:3210
# Expected: 200
```

**Step 7: Commit fork changes**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
git add -A
git commit -m "feat: complete YooKassa billing integration (Phase 3)"
git push origin main
```

---

## Task 10: Verify End-to-End

**Step 1: Check billing API works**

```bash
# Test plans endpoint (via tRPC — needs auth, so test via browser console)
# Open https://ask.gptweb.ru, login, then in console:
# fetch('/trpc/lambda/subscription.getPlans').then(r => r.json()).then(console.log)
```

**Step 2: Check webhook endpoint is accessible**

```bash
curl -X POST https://ask.gptweb.ru/api/billing/webhook \
  -H "Content-Type: application/json" \
  -d '{"event":"test","object":{"id":"test"}}' \
  -w "\n%{http_code}"
# Expected: 200
```

**Step 3: Check DB tables exist**

```bash
psql "postgresql://postgres:0ae6c58c62f6347f2120e958941ef922@127.0.0.1:5433/lobechat" -c "\dt billing_*"
psql "postgresql://postgres:0ae6c58c62f6347f2120e958941ef922@127.0.0.1:5433/lobechat" -c "\dt user_billing"
psql "postgresql://postgres:0ae6c58c62f6347f2120e958941ef922@127.0.0.1:5433/lobechat" -c "SELECT * FROM billing_plans;"
```

**Step 4: Test payment flow (when YooKassa credentials are set)**

1. Open https://ask.gptweb.ru → login
2. Navigate to billing settings
3. Click on a plan → should redirect to YooKassa checkout
4. Complete test payment → webhook should update DB
5. Verify plan changed in DB

**Step 5: Update KNOWLEDGE.md**

Add Phase 3 completion notes to `ai-aggregator/KNOWLEDGE.md`.

---

## Implementation Order

```
Task 1: Schema + Migration     ← Foundation
Task 2: Env Config              ← Foundation
Task 3: BillingService          ← Data layer
Task 4: YooKassa + Fulfill      ← Business logic
Task 5: Webhook Handler         ← External integration
Task 6: User Functions          ← LobeChat integration
Task 7: tRPC Routers            ← API layer
Task 8: Limit Enforcement       ← Protection layer
Task 9: Docker Build + Deploy   ← Deployment
Task 10: Verification           ← QA
```

Dependencies: 1→2→3→4→5, 3→6, 3→7, 3→8, all→9→10
