# Telegram-Link Bonus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grant 100 bonus credits (30-day expiry) when a user first links Telegram. Surface the offer in onboarding, PC sidebar, and mobile bottom-sticky bar. Anti-fraud via a permanent claim stamp.

**Architecture:** Add three columns to `userBilling` (`bonusBalance`, `bonusBalanceExpiresAt`, `tgBonusClaimedAt`). Treat `bonusBalance` as extra capacity that adds to `totalAvailable` while non-expired — the credit system already uses a `tokensUsedMonth` counter against a `plan.tokenLimit + tokenBalance` cap, so we just widen the cap. The grant function is idempotent with row-locking. A daily cron zeros expired bonus pools. UI banner renders different layouts on PC vs mobile.

**Tech Stack:** Next.js 16, Drizzle ORM, vitest, TypeScript strict, Better Auth (TG OIDC), Zustand stores, antd-style for css-in-js.

**Spec:** `docs/superpowers/specs/2026-05-23-tg-link-bonus-design.md` (commit `d85df04148`).

**Key code locations (already audited):**

- Schema: `packages/database/src/schemas/billing.ts` (`userBilling` table)
- Migrations: `packages/database/migrations/NNNN_*.sql` + `meta/_journal.json`. Last migration is `0104_attribution_analytics_ids.sql`. Run `bun run db:generate` to scaffold; commit alongside the schema edit.
- Better Auth hook: `src/libs/better-auth/hooks/telegram-link.ts`
- Spend cap: `src/server/modules/billing/checkUsageLimit.ts` (`totalAvailable = creditLimit + billing.tokenBalance`)
- Same pattern in: `src/server/modules/analytics/expireSubscriptions.ts:65`, `src/business/server/video-generation/chargeBeforeGenerate.ts:86`, `src/business/server/image-generation/chargeBeforeGenerate.ts:89`, `src/business/server/lambda-routers/spend.ts:24,43`
- tRPC userBilling lambda: `src/business/server/lambda-routers/subscription.ts` (look at sibling files for the right router module — userBilling is fetched via the `getBillingState` query there)
- Cron pattern: `src/app/(backend)/api/cron/payment-recovery-notify/route.ts` (auth + summary shape)
- Sidebar: `src/app/[variants]/(main)/home/_layout/Sidebar.tsx` + `SidebarContent.tsx`
- Mobile tab bar: `src/features/MobileTabBar` (see `useShowTabBar` for hide-on-chat behavior)
- Main layout mount point: `src/app/[variants]/(main)/_layout/index.tsx` (where `RetryModal` is already mounted)
- Existing crontab: `/etc/cron.d/lobechat-payment-recovery` (template for new entry)

---

## Task 1: Schema migration — add three columns to `userBilling`

**Files:**

- Modify: `packages/database/src/schemas/billing.ts`

- Generate: `packages/database/migrations/0105_tg_link_bonus.sql` (or whatever next number is)

- Generate: `packages/database/migrations/meta/0090_snapshot.json` (drizzle-kit auto-writes)

- Generate: update `packages/database/migrations/meta/_journal.json`

- [ ] **Step 1: Edit the schema file**

Open `packages/database/src/schemas/billing.ts`. Find the `userBilling = pgTable(...)` block. Inside the columns object, after the existing `autoRenew` field, append:

```ts
    /** Separate balance for non-renewable bonus credits. Adds to
     *  totalAvailable while bonusBalanceExpiresAt > NOW(). Zeroed by
     *  the daily expire-bonus-balance cron once past expiry. */
    bonusBalance: integer('bonus_balance').notNull().default(0),

    /** When the current bonusBalance becomes worthless. NULL means no
     *  active bonus. Set by grant code; read by checkUsageLimit and the
     *  daily expiry cron. */
    bonusBalanceExpiresAt: timestamptz('bonus_balance_expires_at'),

    /** Permanent anti-fraud stamp. Set on first TG-link bonus grant;
     *  never cleared. Re-link attempts read this and skip the grant. */
    tgBonusClaimedAt: timestamptz('tg_bonus_claimed_at'),
```

- [ ] **Step 2: Generate the migration**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
bun run db:generate
```

Expected: drizzle-kit prints `Your SQL migration file ➜ packages/database/migrations/0105_<random>.sql` and updates `meta/_journal.json` + writes a `meta/0090_snapshot.json`.

- [ ] **Step 3: Inspect the generated SQL**

```bash
cat packages/database/migrations/0105_*.sql
```

Expected output (column order may differ — that's fine):

```sql
ALTER TABLE "user_billing"
  ADD COLUMN "bonus_balance" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "bonus_balance_expires_at" timestamp with time zone,
  ADD COLUMN "tg_bonus_claimed_at" timestamp with time zone;
```

If the file name is auto-suffixed weirdly (e.g. `0105_silly_grim_reaper.sql`), rename it to `0105_tg_link_bonus.sql` AND update the corresponding entry in `meta/_journal.json` (the `tag` field) to match.

- [ ] **Step 4: Apply migration to local DB (optional, only if running tests locally)**

```bash
docker exec lobe-postgres psql -U postgres -d lobechat -c "$(cat packages/database/migrations/0105_*.sql)"
```

Expected: `ALTER TABLE`. Skip this step if you'll only ever run prod.

- [ ] **Step 5: Commit**

```bash
git add packages/database/src/schemas/billing.ts \
  packages/database/migrations/0105_tg_link_bonus.sql \
  packages/database/migrations/meta/
git commit -m "feat(billing): schema — bonusBalance, bonusBalanceExpiresAt, tgBonusClaimedAt"
```

---

## Task 2: `grant-tg-link-bonus.ts` — TDD

**Files:**

- Create: `src/server/modules/billing/grant-tg-link-bonus.ts`

- Create: `src/server/modules/billing/__tests__/grant-tg-link-bonus.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/modules/billing/__tests__/grant-tg-link-bonus.test.ts
import { describe, expect, it, beforeEach } from 'vitest';

import { getTestDB } from '@/database/server/__tests__/helpers/test-db'; // if helper missing, see Note
import { userBilling, users } from '@/database/schemas';
import { eq } from 'drizzle-orm';

import { grantTgLinkBonus } from '../grant-tg-link-bonus';

describe('grantTgLinkBonus', () => {
  let db: Awaited<ReturnType<typeof getTestDB>>;
  const userId = 'test-grant-user-' + Date.now();

  beforeEach(async () => {
    db = await getTestDB();
    await db.delete(userBilling).where(eq(userBilling.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
    await db.insert(users).values({ id: userId, email: userId + '@test', emailVerified: false });
  });

  it('grants 100 credits on first call', async () => {
    const r = await grantTgLinkBonus(db, userId);
    expect(r).toMatchObject({ granted: 100, alreadyClaimed: false });
    expect(r.expiresAt).toBeDefined();

    const [row] = await db.select().from(userBilling).where(eq(userBilling.userId, userId));
    expect(row.bonusBalance).toBe(100);
    expect(row.tgBonusClaimedAt).not.toBeNull();
    expect(row.bonusBalanceExpiresAt).not.toBeNull();
    // expiry roughly 30 days out
    const days = (new Date(row.bonusBalanceExpiresAt!).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
  });

  it('is idempotent — second call returns alreadyClaimed=true and does not double-credit', async () => {
    await grantTgLinkBonus(db, userId);
    const r2 = await grantTgLinkBonus(db, userId);
    expect(r2).toMatchObject({ granted: 0, alreadyClaimed: true });
    const [row] = await db.select().from(userBilling).where(eq(userBilling.userId, userId));
    expect(row.bonusBalance).toBe(100);
  });

  it('handles freshly-created user with no user_billing row (insert path)', async () => {
    await db.delete(userBilling).where(eq(userBilling.userId, userId));
    const r = await grantTgLinkBonus(db, userId);
    expect(r).toMatchObject({ granted: 100, alreadyClaimed: false });
  });
});
```

**Note:** If `getTestDB` helper doesn't exist, mock the DB layer instead — create the test using a fake/in-memory drizzle stub OR import `serverDB` directly and run against the dev database (clean up via `afterEach`). The point is to assert the contract, not the DB transport.

- [ ] **Step 2: Run test, confirm failure**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
npx vitest run src/server/modules/billing/__tests__/grant-tg-link-bonus.test.ts
```

Expected: FAIL with `Cannot find module '../grant-tg-link-bonus'`.

- [ ] **Step 3: Implement the module**

```ts
// src/server/modules/billing/grant-tg-link-bonus.ts
import { eq, sql } from 'drizzle-orm';

import { userBilling } from '@/database/schemas';
import { type LobeChatDatabase } from '@/database/type';

export interface GrantTgLinkBonusResult {
  alreadyClaimed: boolean;
  /** ISO timestamp; present iff granted > 0. */
  expiresAt?: string;
  /** 0 if already claimed, 100 on first successful grant. */
  granted: number;
}

const BONUS_AMOUNT = 100;
const EXPIRY_MS = 30 * 86_400_000;

/**
 * Idempotent one-shot grant. Safe under concurrent calls — uses row
 * lock + setWhere clause to guarantee at most one grant per user_id.
 *
 * Best-effort by contract: callers should treat failure as non-fatal
 * (auth shouldn't break if this throws). The DB transaction either
 * commits both bonus + stamp together or commits nothing.
 */
export async function grantTgLinkBonus(
  db: LobeChatDatabase,
  userId: string,
): Promise<GrantTgLinkBonusResult> {
  return db.transaction(async (tx) => {
    // 1) Acquire row lock if the row exists
    const existing = await tx
      .select({ tgBonusClaimedAt: userBilling.tgBonusClaimedAt })
      .from(userBilling)
      .where(eq(userBilling.userId, userId))
      .for('update')
      .limit(1);

    if (existing[0]?.tgBonusClaimedAt) {
      return { granted: 0, alreadyClaimed: true };
    }

    // 2) UPSERT — covers both "row missing" (insert) and "row exists, no stamp" (update)
    const expiresAt = new Date(Date.now() + EXPIRY_MS);
    await tx
      .insert(userBilling)
      .values({
        userId,
        planId: 1,
        bonusBalance: BONUS_AMOUNT,
        bonusBalanceExpiresAt: expiresAt,
        tgBonusClaimedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userBilling.userId,
        set: {
          bonusBalance: sql`${userBilling.bonusBalance} + ${BONUS_AMOUNT}`,
          bonusBalanceExpiresAt: expiresAt,
          tgBonusClaimedAt: sql`NOW()`,
          updatedAt: new Date(),
        },
        // Double-lock: only update if stamp is still null
        setWhere: sql`${userBilling.tgBonusClaimedAt} IS NULL`,
      });

    return {
      granted: BONUS_AMOUNT,
      expiresAt: expiresAt.toISOString(),
      alreadyClaimed: false,
    };
  });
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
npx vitest run src/server/modules/billing/__tests__/grant-tg-link-bonus.test.ts
```

Expected: 3/3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/billing/grant-tg-link-bonus.ts \
  src/server/modules/billing/__tests__/grant-tg-link-bonus.test.ts
git commit -m "feat(billing): grantTgLinkBonus — idempotent +100 credit grant"
```

---

## Task 3: Wire grant into `linkTelegramAccount` hook

**Files:**

- Modify: `src/libs/better-auth/hooks/telegram-link.ts`

- [ ] **Step 1: Add the call**

In `src/libs/better-auth/hooks/telegram-link.ts`, after the FIRST try/catch (the one that sets `tgBotChatId`) and BEFORE the BOT_INTERNAL_TOKEN section, insert:

```ts
// 1.5) Bonus grant — only fires on first-ever TG link per user.
//      Best-effort. Idempotent: subsequent re-links are no-ops.
try {
  const { grantTgLinkBonus } = await import('@/server/modules/billing/grant-tg-link-bonus');
  const result = await grantTgLinkBonus(serverDB, input.userId);
  if (result.granted > 0) {
    console.info('[tg-link] +100 bonus granted to', input.userId, 'expires', result.expiresAt);
  }
} catch (e) {
  console.error('[tg-link] grantTgLinkBonus failed', e);
}
```

(Dynamic import avoids a circular dep at hook-load time. Static import also works if the dependency graph is clean — try the static `import { grantTgLinkBonus } from '@/server/modules/billing/grant-tg-link-bonus';` at the top first; if you hit a circular import, fall back to the dynamic `await import` shown.)

- [ ] **Step 2: Type-check**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
npx tsc --noEmit 2>&1 | grep -E 'telegram-link' || echo OK
```

Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add src/libs/better-auth/hooks/telegram-link.ts
git commit -m "feat(billing): grant +100 bonus credits on first TG link"
```

---

## Task 4: Extend `totalAvailable` math — include active bonus

**Files (modify each):**

- `src/server/modules/billing/checkUsageLimit.ts` (3 sites — lines \~41, \~94, \~167)

- `src/server/modules/analytics/expireSubscriptions.ts` (line \~65)

- `src/business/server/video-generation/chargeBeforeGenerate.ts` (line \~86)

- `src/business/server/image-generation/chargeBeforeGenerate.ts` (line \~89)

- `src/business/server/lambda-routers/spend.ts` (lines \~24, \~43)

- [ ] **Step 1: Create the helper**

Add a new file `src/server/modules/billing/active-bonus.ts`:

```ts
import type { InferSelectModel } from 'drizzle-orm';
import type { userBilling } from '@/database/schemas';

type UserBillingRow = Pick<
  InferSelectModel<typeof userBilling>,
  'bonusBalance' | 'bonusBalanceExpiresAt'
>;

/**
 * Return the bonus credit amount currently counting toward
 * totalAvailable. Returns 0 if no bonus, balance is zero, or expired.
 *
 * Centralised so every cap-computation site uses the same logic.
 */
export function activeBonusFor(row: UserBillingRow | null | undefined): number {
  if (!row) return 0;
  if (!row.bonusBalance || row.bonusBalance <= 0) return 0;
  if (!row.bonusBalanceExpiresAt) return 0;
  if (new Date(row.bonusBalanceExpiresAt).getTime() <= Date.now()) return 0;
  return row.bonusBalance;
}
```

Add a test `src/server/modules/billing/__tests__/active-bonus.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { activeBonusFor } from '../active-bonus';

describe('activeBonusFor', () => {
  it('returns 0 for null', () => expect(activeBonusFor(null)).toBe(0));
  it('returns 0 when bonusBalance=0', () =>
    expect(
      activeBonusFor({ bonusBalance: 0, bonusBalanceExpiresAt: new Date(Date.now() + 86_400_000) }),
    ).toBe(0));
  it('returns 0 when expiry passed', () =>
    expect(
      activeBonusFor({ bonusBalance: 100, bonusBalanceExpiresAt: new Date(Date.now() - 1000) }),
    ).toBe(0));
  it('returns 0 when expiry null', () =>
    expect(activeBonusFor({ bonusBalance: 100, bonusBalanceExpiresAt: null })).toBe(0));
  it('returns bonusBalance when active', () =>
    expect(
      activeBonusFor({
        bonusBalance: 100,
        bonusBalanceExpiresAt: new Date(Date.now() + 86_400_000),
      }),
    ).toBe(100));
});
```

Run: `npx vitest run src/server/modules/billing/__tests__/active-bonus.test.ts` — expect 5/5 passed.

- [ ] **Step 2: Update `checkUsageLimit.ts`**

In `src/server/modules/billing/checkUsageLimit.ts`:

1. Add at top: `import { activeBonusFor } from './active-bonus';`
2. In the first function (\~line 41), wherever `billing.tokenBalance` appears in `totalAvailable = creditLimit + billing.tokenBalance`, change to:
   ```ts
   const totalAvailable = creditLimit + billing.tokenBalance + activeBonusFor(billing);
   ```
3. Repeat for sites at \~line 94 and \~line 167 (use `row.tokenBalance + activeBonusFor(row)` and `billing.tokenBalance ?? 0) + activeBonusFor(billing)` respectively).
4. Also ensure the SELECT in `incrementTokensUsed` cap-computation includes `bonusBalance` + `bonusBalanceExpiresAt` if it does not — without these the helper returns 0 and the cap is under-counted. Check line \~80 (`getBilling` SELECT) and add the two columns if missing.

- [ ] **Step 3: Update `expireSubscriptions.ts:43-65`**

Two changes:

1. SELECT must include `bonusBalance` and `bonusBalanceExpiresAt`.
2. `totalAvailable = plan.tokenLimit + row.tokenBalance` → `+ activeBonusFor(row)`.

- [ ] **Step 4: Update `chargeBeforeGenerate.ts` (image + video)**

Same shape — add `activeBonusFor(billing)` to the `monthlyCap` sum at line 86 (video) and line 89 (image). Confirm `billing` object includes the two columns; if it's loaded via `BillingService.getOrResetUserBilling`, the SELECT inside that method may need updating.

- [ ] **Step 5: Update `spend.ts:24,43`**

Same pattern — add `activeBonusFor(billing)` to `totalAvailable`.

- [ ] **Step 6: Type-check + run all billing tests**

```bash
npx tsc --noEmit 2>&1 | grep -E 'checkUsageLimit|expireSubscriptions|chargeBeforeGenerate|spend|active-bonus' || echo OK
npx vitest run src/server/modules/billing src/business/server/image-generation src/business/server/video-generation src/business/server/lambda-routers
```

Expected: `OK` for tsc, all existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add src/server/modules/billing/active-bonus.ts \
  src/server/modules/billing/__tests__/active-bonus.test.ts \
  src/server/modules/billing/checkUsageLimit.ts \
  src/server/modules/analytics/expireSubscriptions.ts \
  src/business/server/video-generation/chargeBeforeGenerate.ts \
  src/business/server/image-generation/chargeBeforeGenerate.ts \
  src/business/server/lambda-routers/spend.ts
git commit -m "feat(billing): include active bonusBalance in totalAvailable cap"
```

---

## Task 5: Expiry cron — `/api/cron/expire-bonus-balance`

**Files:**

- Create: `src/app/(backend)/api/cron/expire-bonus-balance/route.ts`

- [ ] **Step 1: Implement the route**

```ts
// src/app/(backend)/api/cron/expire-bonus-balance/route.ts
import { sql } from 'drizzle-orm';

import { getServerDB } from '@/database/server';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const db = await getServerDB();
  const result = await db.execute(sql`
    UPDATE user_billing
    SET bonus_balance = 0,
        bonus_balance_expires_at = NULL,
        updated_at = NOW()
    WHERE bonus_balance > 0
      AND bonus_balance_expires_at IS NOT NULL
      AND bonus_balance_expires_at < NOW()
    RETURNING user_id
  `);

  return Response.json({ ok: true, expired_count: result.rows.length });
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -E 'expire-bonus-balance' || echo OK
```

Expected: `OK`.

- [ ] **Step 3: Add the host crontab entry**

Create `/etc/cron.d/lobechat-expire-bonus-balance` (NOT in the repo — this is host-side ops). Contents:

```
# Daily 03:00 MSK — zero out expired bonus balances.
0 3 * * * deploy curl -fsS -H "Authorization: Bearer $(grep '^CRON_SECRET=' /opt/lobechat/.env | cut -d= -f2-)" https://ask.gptweb.ru/api/cron/expire-bonus-balance >> /var/log/lobechat-expire-bonus-balance.log 2>&1
```

```bash
sudo tee /etc/cron.d/lobechat-expire-bonus-balance > /dev/null << 'EOF'
# Daily 03:00 MSK — zero out expired bonus balances.
0 3 * * * deploy curl -fsS -H "Authorization: Bearer $(grep '^CRON_SECRET=' /opt/lobechat/.env | cut -d= -f2-)" https://ask.gptweb.ru/api/cron/expire-bonus-balance >> /var/log/lobechat-expire-bonus-balance.log 2>&1
EOF
sudo chmod 644 /etc/cron.d/lobechat-expire-bonus-balance
sudo touch /var/log/lobechat-expire-bonus-balance.log
sudo chown deploy:deploy /var/log/lobechat-expire-bonus-balance.log
```

- [ ] **Step 4: Commit (route only)**

```bash
git add 'src/app/(backend)/api/cron/expire-bonus-balance/route.ts'
git commit -m "feat(cron): expire-bonus-balance — daily zero of stale bonus pools"
```

---

## Task 6: tRPC mutation `userBilling.claimTgLinkBonus`

**Files:**

- Modify: existing userBilling lambda router (find it under `src/business/server/lambda-routers/`). The router that owns `getBillingState` is the right home.

- [ ] **Step 1: Locate the router**

```bash
grep -rln 'getBillingState' src/business/server/lambda-routers/ | head -3
```

The file printed (call it `<userBillingRouter>.ts`) is where the mutation goes.

- [ ] **Step 2: Add the mutation**

In that router file, alongside the existing procedures, add:

```ts
import { eq } from 'drizzle-orm';

import { userBilling } from '@/database/schemas';
import { grantTgLinkBonus } from '@/server/modules/billing/grant-tg-link-bonus';

// ...existing router definition continues...

  claimTgLinkBonus: authedProcedure.mutation(async ({ ctx }) => {
    // Read current state — only proceed if user has TG linked but no claim yet
    const [row] = await ctx.serverDB
      .select({
        tgBotChatId: userBilling.tgBotChatId,
        tgBonusClaimedAt: userBilling.tgBonusClaimedAt,
      })
      .from(userBilling)
      .where(eq(userBilling.userId, ctx.userId))
      .limit(1);

    if (!row?.tgBotChatId) {
      return { granted: 0, alreadyClaimed: false, error: 'tg_not_linked' as const };
    }
    if (row.tgBonusClaimedAt) {
      return { granted: 0, alreadyClaimed: true };
    }

    return grantTgLinkBonus(ctx.serverDB, ctx.userId);
  }),
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -E 'claimTgLinkBonus' || echo OK
```

Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add src/business/server/lambda-routers/
git commit -m "feat(billing): tRPC userBilling.claimTgLinkBonus mutation"
```

---

## Task 7: `useShouldShow` + claim-on-return hook

**Files:**

- Create: `src/features/TgLinkBonusBanner/useShouldShow.ts`

- Create: `src/features/TgLinkBonusBanner/useClaimOnReturn.ts`

- [ ] **Step 1: useShouldShow**

```ts
// src/features/TgLinkBonusBanner/useShouldShow.ts
'use client';

import { useEffect, useState } from 'react';

import { lambdaClient } from '@/libs/trpc/client';

const DISMISS_KEY = 'tg_link_banner_dismissed_until';

/**
 * Returns true iff the user has no TG link AND no claim stamp AND
 * hasn't dismissed within the last 7 days.
 */
export function useShouldShow(): boolean {
  const { data } = lambdaClient.subscription.getBillingState.useQuery(undefined, {
    staleTime: 60_000,
  });

  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return;
    const until = Number(raw);
    if (Number.isFinite(until) && until > Date.now()) setDismissed(true);
  }, []);

  if (dismissed) return false;
  if (!data) return false;
  if (data.tgBotChatId) return false;
  if (data.tgBonusClaimedAt) return false;
  return true;
}

export function dismissBanner() {
  localStorage.setItem(DISMISS_KEY, String(Date.now() + 7 * 86_400_000));
}
```

NOTE: `getBillingState` may not currently expose `tgBotChatId` or `tgBonusClaimedAt` on its return shape. If so, extend the query in the router (small additive change in the same lambda router file from Task 6). The keys must be camelCase to match Drizzle's `$inferSelect`.

- [ ] **Step 2: useClaimOnReturn**

```ts
// src/features/TgLinkBonusBanner/useClaimOnReturn.ts
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { message } from 'antd';

import { lambdaClient } from '@/libs/trpc/client';

/**
 * If the user lands on the app with ?tg_linked=1 in the URL, call the
 * idempotent claim mutation, toast on success, scrub the param.
 */
export function useClaimOnReturn() {
  const router = useRouter();
  const params = useSearchParams();
  const ran = useRef(false);
  const claim = lambdaClient.subscription.claimTgLinkBonus.useMutation();
  const utils = lambdaClient.useUtils();

  useEffect(() => {
    if (ran.current) return;
    if (params.get('tg_linked') !== '1') return;
    ran.current = true;

    claim.mutate(undefined, {
      onSuccess: async (data) => {
        if (data.granted > 0) {
          message.success(`🎁 +${data.granted} кредитов на 30 дней!`);
          await utils.subscription.getBillingState.invalidate();
        }
        const url = new URL(window.location.href);
        url.searchParams.delete('tg_linked');
        router.replace(url.pathname + url.search);
      },
      onError: () => {
        // Quiet failure — don't surprise the user with an error toast
        // about a bonus they may or may not have known about.
        console.warn('[tg-link-bonus] claim mutation failed');
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -E 'TgLinkBonusBanner' || echo OK
```

Expected: `OK`. If `claimTgLinkBonus` isn't visible on `lambdaClient.subscription`, the tRPC client types need a rebuild — run `npx vitest --run` once to trigger the type generation or check that Task 6 actually exported the mutation into the right router.

- [ ] **Step 4: Commit**

```bash
git add src/features/TgLinkBonusBanner/useShouldShow.ts \
  src/features/TgLinkBonusBanner/useClaimOnReturn.ts
git commit -m "feat(ui): TgLinkBonusBanner hooks — visibility + claim-on-return"
```

---

## Task 8: PC sidebar card

**Files:**

- Create: `src/features/TgLinkBonusBanner/PcSidebarCard.tsx`

- [ ] **Step 1: Implement the card**

```tsx
// src/features/TgLinkBonusBanner/PcSidebarCard.tsx
'use client';

import { createStyles } from 'antd-style';
import { X } from 'lucide-react';
import { memo } from 'react';

import { useShouldShow, dismissBanner } from './useShouldShow';

const useStyles = createStyles(({ token, css }) => ({
  card: css`
    position: relative;
    margin: 8px 12px;
    padding: 12px 14px;
    background: linear-gradient(135deg, #229ed9 0%, #1d8ec5 100%);
    color: #fff;
    border-radius: 10px;
    font-size: 13px;
    line-height: 1.4;
  `,
  title: css`
    font-weight: 600;
    margin-bottom: 4px;
  `,
  cta: css`
    display: inline-block;
    margin-top: 8px;
    padding: 6px 12px;
    background: rgba(255, 255, 255, 0.18);
    color: #fff;
    border-radius: 6px;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
    border: none;

    &:hover {
      background: rgba(255, 255, 255, 0.28);
    }
  `,
  dismiss: css`
    position: absolute;
    top: 6px;
    right: 6px;
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
    padding: 2px;

    &:hover {
      color: #fff;
    }
  `,
}));

function startTgLink() {
  // Open settings/account where the user can link TG. The existing
  // settings page has a TG-link button — sending them there preserves
  // the in-app flow rather than punching out to an OAuth tab.
  window.location.href =
    '/settings/account?action=link_tg&return=' +
    encodeURIComponent(window.location.pathname + '?tg_linked=1');
}

const PcSidebarCard = memo(() => {
  const { styles } = useStyles();
  const show = useShouldShow();
  if (!show) return null;

  return (
    <div className={styles.card}>
      <button className={styles.dismiss} onClick={dismissBanner} aria-label="Скрыть">
        <X size={14} />
      </button>
      <div className={styles.title}>🎁 +100 кредитов</div>
      <div>Привяжи Telegram и получи 100 кредитов на 30 дней.</div>
      <button className={styles.cta} onClick={startTgLink}>
        Привязать
      </button>
    </div>
  );
});

PcSidebarCard.displayName = 'PcSidebarCard';
export default PcSidebarCard;
```

NOTE: The actual TG-link flow URL/behavior depends on existing settings page. Read `src/app/[variants]/(main)/settings/account/` first and adjust `startTgLink()` to call whatever existing handler initiates a TG-link (probably a Better Auth `signIn.social({ provider: 'telegram' })` call). If a clean entry point exists, replace the `window.location.href` redirect with that.

- [ ] **Step 2: Commit**

```bash
git add src/features/TgLinkBonusBanner/PcSidebarCard.tsx
git commit -m "feat(ui): PC sidebar card for TG-link bonus"
```

---

## Task 9: Mobile bottom-sticky bar

**Files:**

- Create: `src/features/TgLinkBonusBanner/MobileStickyBar.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/features/TgLinkBonusBanner/MobileStickyBar.tsx
'use client';

import { createStyles } from 'antd-style';
import { X } from 'lucide-react';
import { memo } from 'react';

import { useShouldShow, dismissBanner } from './useShouldShow';

// MobileTabBar height — keep in sync with src/features/MobileTabBar
const MOBILE_TAB_BAR_HEIGHT = 56;

const useStyles = createStyles(({ css }) => ({
  bar: css`
    position: fixed;
    left: 0;
    right: 0;
    bottom: calc(${MOBILE_TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom, 0px));
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
    background: linear-gradient(135deg, #229ed9 0%, #1d8ec5 100%);
    color: #fff;
    z-index: 999;
    box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.12);
    font-size: 14px;
  `,
  text: css`
    flex: 1;
    line-height: 1.2;
    min-width: 0;
    margin-right: 8px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  cta: css`
    flex: 0 0 auto;
    background: rgba(255, 255, 255, 0.22);
    border: none;
    color: #fff;
    padding: 6px 14px;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
  `,
  dismiss: css`
    flex: 0 0 auto;
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.7);
    margin-left: 6px;
    padding: 6px;
    cursor: pointer;
  `,
}));

function startTgLink() {
  window.location.href =
    '/settings/account?action=link_tg&return=' +
    encodeURIComponent(window.location.pathname + '?tg_linked=1');
}

const MobileStickyBar = memo(() => {
  const { styles } = useStyles();
  const show = useShouldShow();
  if (!show) return null;

  return (
    <div className={styles.bar}>
      <div className={styles.text}>🎁 Привяжи Telegram и получи 100 кредитов</div>
      <button className={styles.cta} onClick={startTgLink}>
        Привязать
      </button>
      <button className={styles.dismiss} onClick={dismissBanner} aria-label="Скрыть">
        <X size={16} />
      </button>
    </div>
  );
});

MobileStickyBar.displayName = 'MobileStickyBar';
export default MobileStickyBar;
```

- [ ] **Step 2: Commit**

```bash
git add src/features/TgLinkBonusBanner/MobileStickyBar.tsx
git commit -m "feat(ui): mobile bottom-sticky bar for TG-link bonus"
```

---

## Task 10: Public banner entry + mount in layout

**Files:**

- Create: `src/features/TgLinkBonusBanner/index.tsx`

- Modify: `src/app/[variants]/(main)/_layout/index.tsx`

- [ ] **Step 1: Public entry — branches on viewport**

```tsx
// src/features/TgLinkBonusBanner/index.tsx
'use client';

import dynamic from '@/libs/next/dynamic';
import { useIsMobile } from '@/hooks/useIsMobile';

import { useClaimOnReturn } from './useClaimOnReturn';

const PcSidebarCard = dynamic(() => import('./PcSidebarCard'));
const MobileStickyBar = dynamic(() => import('./MobileStickyBar'));

/**
 * Public entry. Mount ONCE globally — handles claim-on-return
 * regardless of viewport, and renders the appropriate banner.
 *
 * The PC card is positioned by the sidebar (Task 11 mounts it INSIDE
 * the sidebar, not here). The mobile sticky bar is positioned by its
 * own fixed CSS.
 *
 * This module only exports the mobile bar via the default export;
 * PcSidebarCard is imported separately by the sidebar component.
 */
export function TgLinkBonusGlobal() {
  useClaimOnReturn();
  const isMobile = useIsMobile();
  if (!isMobile) return null;
  return <MobileStickyBar />;
}

export { PcSidebarCard, MobileStickyBar };
```

- [ ] **Step 2: Mount in main layout**

In `src/app/[variants]/(main)/_layout/index.tsx`, near where `RetryModal` is mounted (around line 119), add:

```tsx
import { TgLinkBonusGlobal } from '@/features/TgLinkBonusBanner';
```

And inside the JSX, alongside `<RetryModal />`:

```tsx
<RetryModal />
<TgLinkBonusGlobal />
```

- [ ] **Step 3: Mount PC card inside the sidebar**

In `src/app/[variants]/(main)/home/_layout/Sidebar.tsx` (or wherever `SidebarContent.tsx` composes the sidebar items), add at the bottom (or wherever feels right — above any footer/user area):

```tsx
import { PcSidebarCard } from '@/features/TgLinkBonusBanner';

// ...inside the render tree, near the bottom of the sidebar content:
<PcSidebarCard />;
```

The card renders nothing if `useShouldShow()` returns false — safe to mount unconditionally.

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -E 'TgLinkBonus|_layout/index|Sidebar' || echo OK
```

Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add src/features/TgLinkBonusBanner/index.tsx \
  'src/app/[variants]/(main)/_layout/index.tsx' \
  'src/app/[variants]/(main)/home/_layout/Sidebar.tsx'
git commit -m "feat(ui): mount TgLinkBonusBanner globally + PC sidebar card"
```

---

## Task 11: Onboarding step

**Files:**

- Read first: `src/app/[variants]/onboarding/index.tsx` + `src/app/[variants]/onboarding/_layout/index.tsx` + `src/store/user/slices/onboarding/` to understand the step model.
- Create: `src/features/Onboarding/steps/TelegramLinkStep.tsx`
- Modify: the onboarding step registry (depends on what the audit reveals)

This is the riskiest task because the onboarding state machine is non-trivial. Adding a step the wrong way breaks the whole flow.

- [ ] **Step 1: Audit the existing onboarding flow**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
ls src/app/\[variants\]/onboarding/
cat src/store/user/slices/onboarding/initialState.ts
grep -rE "step\s*[:=]" src/store/user/slices/onboarding/ | head -20
```

Identify: (a) where the list of steps is defined, (b) how the step order/index advances, (c) whether the step list is server-side (DB column) or client-side (constant).

- [ ] **Step 2: Add the step**

Follow whatever pattern the audit reveals. Two common shapes:

- **Constant array of step IDs** in a TS file → insert `'tg_link'` at the right position (after welcome, before plan-picker — or wherever it best fits).
- **DB-backed enum** → may require a schema migration. If so, scope this task as a separate sub-task and defer.

Render condition: `if user.tgBotChatId || user.tgBonusClaimedAt → skip step entirely (auto-advance)`.

The step content:

```tsx
// src/features/Onboarding/steps/TelegramLinkStep.tsx
'use client';

import { Button } from 'antd';
import { createStyles } from 'antd-style';

const useStyles = createStyles(({ css }) => ({
  wrap: css`
    text-align: center;
    max-width: 480px;
    margin: 0 auto;
    padding: 32px 16px;
  `,
  emoji: css`
    font-size: 56px;
    margin-bottom: 8px;
  `,
  title: css`
    font-size: 24px;
    font-weight: 700;
    margin-bottom: 8px;
  `,
  subtitle: css`
    color: #666;
    font-size: 15px;
    margin-bottom: 24px;
  `,
  cta: css`
    min-width: 200px;
  `,
  skip: css`
    display: block;
    margin-top: 14px;
    color: #888;
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 13px;

    &:hover {
      color: #444;
    }
  `,
}));

interface Props {
  onNext: () => void;
}

export default function TelegramLinkStep({ onNext }: Props) {
  const { styles } = useStyles();

  function startLink() {
    window.location.href =
      '/settings/account?action=link_tg&return=' + encodeURIComponent('/?tg_linked=1');
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.emoji}>🎁</div>
      <div className={styles.title}>Привяжи Telegram — получи 100 кредитов</div>
      <div className={styles.subtitle}>
        Бесплатные 100 кредитов на 30 дней. Плюс — задавай вопросы боту прямо в Telegram.
      </div>
      <Button type="primary" size="large" className={styles.cta} onClick={startLink}>
        Привязать через Telegram
      </Button>
      <button className={styles.skip} onClick={onNext}>
        Пропустить
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Register the step + run the app**

Wire up per the audit findings. Then start the dev server (or check the prod build) and walk through a fresh registration to confirm the step appears.

- [ ] **Step 4: Commit**

```bash
git add src/features/Onboarding/steps/TelegramLinkStep.tsx \
        <onboarding registry file>
git commit -m "feat(onboarding): TelegramLinkStep — +100 credits on TG link"
```

---

## Task 12: Backfill, deploy, smoke

**Files:** none in repo. Operational.

- [ ] **Step 1: Migrate prod DB**

```bash
ssh deploy@135.181.115.234 # if not already on the box
cd /home/deploy/projects/ai-aggregator-lobechat
docker exec lobe-postgres psql -U postgres -d lobechat -c "$(cat packages/database/migrations/0105_*.sql)"
```

Expected: `ALTER TABLE`. Re-running is a no-op once columns exist (use `ADD COLUMN IF NOT EXISTS` if you want to be defensive — the auto-generated migration may not include this, in which case skip the re-run).

- [ ] **Step 2: Backfill existing TG-linked users**

```bash
docker exec lobe-postgres psql -U postgres -d lobechat -c "
UPDATE user_billing
SET tg_bonus_claimed_at = NOW(),
    bonus_balance = bonus_balance + 100,
    bonus_balance_expires_at = NOW() + INTERVAL '30 days',
    updated_at = NOW()
WHERE tg_bot_chat_id IS NOT NULL
  AND tg_bonus_claimed_at IS NULL;
"
```

Expected: `UPDATE N` where N is the count of pre-existing TG-linked users.

- [ ] **Step 3: Build + deploy**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
git push origin canary
docker build -t lobechat-custom:latest .
cd /opt/lobechat && docker compose up -d lobe
sleep 12 && curl -s -o /dev/null -w '%{http_code}\n' https://ask.gptweb.ru/
```

Expected last line: `200`.

- [ ] **Step 4: Smoke — fresh test account**

1. Open a private/incognito browser window.
2. Register a new account via email or Google (NOT TG, so the bonus path goes through banner/onboarding rather than the auth hook).
3. Confirm the onboarding step appears.
4. Click "Привязать через Telegram" — complete TG OIDC.
5. After return, confirm: toast "🎁 +100 кредитов на 30 дней" appears AND the balance in settings/profile is +100.
6. Confirm the banner is gone on reload (because `tgBonusClaimedAt` is now set).

- [ ] **Step 5: Anti-fraud smoke**

1. With the same account, go to settings/account → unlink TG.
2. Re-link TG (any TG account — same or new).
3. Confirm: NO toast appears, balance does NOT increment further. DB shows `tg_bonus_claimed_at` unchanged.

- [ ] **Step 6: Trigger the expiry cron manually**

```bash
CRON_SECRET=$(grep -E '^CRON_SECRET=' /opt/lobechat/.env | cut -d= -f2-)
curl -s -H "Authorization: Bearer $CRON_SECRET" https://ask.gptweb.ru/api/cron/expire-bonus-balance
```

Expected: `{"ok":true,"expired_count":0}` (no expiries yet — first cohort hits day-30 about a month from now).

- [ ] **Step 7: Forced expiry verification**

```bash
docker exec lobe-postgres psql -U postgres -d lobechat -c "
UPDATE user_billing SET bonus_balance_expires_at = NOW() - INTERVAL '1 minute'
WHERE user_id = '<TEST_USER_ID>';
"

CRON_SECRET=$(grep -E '^CRON_SECRET=' /opt/lobechat/.env | cut -d= -f2-)
curl -s -H "Authorization: Bearer $CRON_SECRET" https://ask.gptweb.ru/api/cron/expire-bonus-balance
```

Expected: `{"ok":true,"expired_count":1}`. Then confirm in DB:

```bash
docker exec lobe-postgres psql -U postgres -d lobechat -tA -c "
SELECT bonus_balance, bonus_balance_expires_at
FROM user_billing WHERE user_id = '<TEST_USER_ID>';
"
```

Expected: `0|` (zero balance, NULL expiry).

---

## Self-Review

**Spec coverage check:**

- ✅ Data model (3 columns): T1
- ✅ Grant logic: T2
- ✅ Hook integration: T3
- ✅ Spend math (extending cap, not consuming pool): T4 — note this DIVERGES from spec's "consumed first" wording; the codebase uses a usage-counter model, so extending the cap is the correct mechanism. Same behavior from user's perspective.
- ✅ Expiry cron: T5
- ✅ tRPC mutation: T6
- ✅ Hooks (useShouldShow + useClaimOnReturn): T7
- ✅ PC sidebar card: T8
- ✅ Mobile bottom sticky: T9
- ✅ Mount: T10
- ✅ Onboarding step: T11
- ✅ Backfill + smoke: T12

**Placeholder scan:** none — every code block is concrete. The onboarding step (T11) has more flex because the existing step-machine wasn't fully audited at planning time; the task itself includes an audit step (Step 1).

**Type consistency:**

- `GrantTgLinkBonusResult { granted, alreadyClaimed, expiresAt? }` consistent in T2, T6, T7 ✅
- `activeBonusFor` signature consistent across T4 callers ✅
- Column names `bonusBalance`, `bonusBalanceExpiresAt`, `tgBonusClaimedAt` consistent everywhere ✅
- LocalStorage key `tg_link_banner_dismissed_until` consistent T7 ✅

**Divergence from spec to flag:**

- The spec said "bonus consumed first via change to charge wrapper". Reality: credits aren't debited from `tokenBalance` — they're tracked via `tokensUsedMonth` counter against a cap = `plan.tokenLimit + tokenBalance + activeBonus`. So the plan extends the cap rather than altering a debit path. Same user-visible behavior (bonus contributes to spending headroom, expires after 30 days).
