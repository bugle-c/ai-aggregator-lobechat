# Referral System V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Activate the dormant 2-level referral pipeline per spec: L1 +100/+100, L2 +30, 30-day expiry via `bonusBalance`, triggered by Telegram link.

**Architecture:** Most of the pipeline already exists. Adapt `src/server/modules/referrals/onSignup.ts` + `rewardOnFirstPayment.ts` + Better-Auth hooks rather than rewriting. New work: landing-side `_ref` cookie middleware, trigger migration from first-payment → TG-link, switch payout pool from `tokenBalance` → `bonusBalance`, partial UNIQUE index, UI surface.

**Tech Stack:** Next.js 16 (middleware), Drizzle, vitest, TypeScript strict, Better Auth.

**Spec:** `docs/superpowers/specs/2026-05-24-referral-system-design.md` (commit `fc35f81c68`).

**Existing surfaces (audited):**

- `src/server/modules/referrals/onSignup.ts` — captures `_ref` cookie, anti-abuse gate, writes `users.referred_by_l1/l2` + `referrals(L1, L2, status='pending')`. Welcome bonus +20 → `tokenBalance` (to be removed).
- `src/server/modules/referrals/rewardOnFirstPayment.ts` — current reward trigger. Constants `L1_REWARD_CREDITS = 50`, `L2_REWARD_CREDITS = 25`. Credits go to `tokenBalance`. Called from `src/server/modules/billing/fulfill.ts` after status='succeeded' flip.
- `src/server/modules/referrals/antiAbuse.ts` — disposable email, self-refer, IP velocity.
- `src/server/modules/referrals/__tests__/` — onSignup.test.ts, antiAbuse.test.ts (rewardOnFirstPayment has no test).
- `src/libs/better-auth/define-config.ts` lines \~231-260 — `databaseHooks.user.create.after` already calls `processReferralSignup`.
- `src/libs/better-auth/hooks/telegram-link.ts` — fires on `account.create.after` for `providerId='telegram'`. Already grants `tgBonusClaimedAt` + `grantTgLinkBonus`.
- `src/business/client/BusinessSettingPages/Referral.tsx` — existing UI page (with dormant cashout).
- `src/components/CreditsExhaustedModal/CreditsExhaustedModal.tsx` — modal with "Купить тариф" CTA.
- `_ref` cookie SETTER: **does not exist** in repo. Likely set by separate landing/marketing host. Direct hits to `ask.gptweb.ru/?ref=CODE` currently lose the code. Task 6 fixes this.

---

## Task 1: Rewards module — switch from `rewardOnFirstPayment` to TG-link trigger

**Files:**

- Rename: `src/server/modules/referrals/rewardOnFirstPayment.ts` → `src/server/modules/referrals/processReferralRewards.ts`

- Update tests: `src/server/modules/referrals/__tests__/` (rename if needed)

- [ ] **Step 1: Rewrite the rewards function**

Replace contents of `src/server/modules/referrals/rewardOnFirstPayment.ts` with a new module. We rename the file too for clarity. Final state at `src/server/modules/referrals/processReferralRewards.ts`:

```ts
/**
 * Award referral rewards when a referee links Telegram. Replaces the
 * earlier first-payment trigger — TG link is a stronger anti-fraud
 * signal (unique phone per Telegram account) and unblocks rewards
 * before the referee has to pay anything.
 *
 * Flow:
 *   1. Find `referrals` rows where `referred_user_id = userId AND status='pending'`.
 *   2. For each:
 *      - L1 row: credit BOTH the referrer (+100) and the referee (+100).
 *      - L2 row: credit only the L2 referrer (+30). No referee top-up at L2.
 *   3. Mark the row 'rewarded' with `credits_awarded` set and `rewarded_at` stamped.
 *   4. All credits go to `userBilling.bonus_balance` with 30-day expiry
 *      (`bonus_balance_expires_at = MAX(existing, NOW() + 30d)`).
 *
 * Each award runs in its own transaction so a failure on one level
 * doesn't roll back the other. Conditional UPDATE on status='pending'
 * guarantees idempotence under concurrent calls.
 */
import { and, eq, sql } from 'drizzle-orm';

import { referrals, userBilling } from '@/database/schemas';
import { type LobeChatDatabase } from '@/database/type';

/** Credits to L1 referrer (the friend who shared the link). */
export const L1_REFERRER_CREDITS = 100;
/** Credits to the referee themselves (bonus for completing the loop). */
export const L1_REFEREE_CREDITS = 100;
/** Credits to L2 referrer (grand-parent — friend-of-friend). */
export const L2_REFERRER_CREDITS = 30;

const EXPIRY_MS = 30 * 86_400_000;

async function addBonusBalance(
  tx: Parameters<Parameters<LobeChatDatabase['transaction']>[0]>[0],
  userId: string,
  credits: number,
) {
  const expiresAt = new Date(Date.now() + EXPIRY_MS);
  await tx.execute(sql`
    INSERT INTO user_billing (user_id, plan_id, bonus_balance, bonus_balance_expires_at)
    VALUES (${userId}, 1, ${credits}, ${expiresAt.toISOString()})
    ON CONFLICT (user_id) DO UPDATE
    SET bonus_balance = user_billing.bonus_balance + ${credits},
        bonus_balance_expires_at = GREATEST(
          COALESCE(user_billing.bonus_balance_expires_at, ${expiresAt.toISOString()}::timestamptz),
          ${expiresAt.toISOString()}::timestamptz
        ),
        updated_at = NOW()
  `);
}

/**
 * Run referral payouts for the given referee. Idempotent — pending-row
 * status filter prevents double-award. Best-effort: caller wraps in
 * try/catch so a hiccup never blocks the surrounding flow.
 */
export async function processReferralRewards(
  db: LobeChatDatabase,
  refereeUserId: string,
): Promise<{ awardedCount: number; totalCredits: number }> {
  const pendingRefs = await db
    .select()
    .from(referrals)
    .where(and(eq(referrals.referredUserId, refereeUserId), eq(referrals.status, 'pending')));

  if (pendingRefs.length === 0) return { awardedCount: 0, totalCredits: 0 };

  let awardedCount = 0;
  let totalCredits = 0;

  for (const ref of pendingRefs) {
    try {
      await db.transaction(async (tx) => {
        // Flip status FIRST so a parallel call races us harmlessly — only
        // the row whose UPDATE actually flipped the status proceeds to grant.
        const flipped = await tx
          .update(referrals)
          .set({
            status: 'rewarded',
            creditsAwarded: ref.level === 1 ? L1_REFERRER_CREDITS : L2_REFERRER_CREDITS,
            rewardedAt: new Date(),
          })
          .where(and(eq(referrals.id, ref.id), eq(referrals.status, 'pending')))
          .returning({ id: referrals.id });

        if (flipped.length === 0) return; // race lost

        if (ref.level === 1) {
          await addBonusBalance(tx, ref.referrerUserId, L1_REFERRER_CREDITS);
          await addBonusBalance(tx, refereeUserId, L1_REFEREE_CREDITS);
          totalCredits += L1_REFERRER_CREDITS + L1_REFEREE_CREDITS;
        } else {
          await addBonusBalance(tx, ref.referrerUserId, L2_REFERRER_CREDITS);
          totalCredits += L2_REFERRER_CREDITS;
        }
        awardedCount++;
      });
      console.info(
        `[referrals] rewarded L${ref.level}: referrer=${ref.referrerUserId} referred=${refereeUserId}`,
      );
    } catch (error) {
      console.error(`[referrals] reward failed ref=${ref.id} level=${ref.level}:`, error);
    }
  }

  return { awardedCount, totalCredits };
}
```

- [ ] **Step 2: Delete the old file**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
git mv src/server/modules/referrals/rewardOnFirstPayment.ts \
  src/server/modules/referrals/processReferralRewards.ts
```

Then paste the new contents from Step 1 over the renamed file.

- [ ] **Step 3: Remove call site from fulfillPayment**

In `src/server/modules/billing/fulfill.ts`, find and DELETE the import + call:

```ts
// DELETE THIS IMPORT:
import { rewardReferralsOnFirstPayment } from '@/server/modules/referrals/rewardOnFirstPayment';
```

And the call (search for `rewardReferralsOnFirstPayment(`). Replace it with a brief comment:

```ts
// (Referral rewards now trigger from linkTelegramAccount hook — see
//  src/libs/better-auth/hooks/telegram-link.ts and
//  src/server/modules/referrals/processReferralRewards.ts.)
```

- [ ] **Step 4: Wire into telegram-link hook**

In `src/libs/better-auth/hooks/telegram-link.ts`, after the existing `grantTgLinkBonus` try/catch block, add another best-effort block:

```ts
// 1.6) Referral payouts — referee just linked TG, which is our anti-
//      fraud gate. Flip any pending `referrals` rows to 'rewarded' and
//      credit the L1/L2 referrers + the referee themselves.
try {
  const { processReferralRewards } =
    await import('@/server/modules/referrals/processReferralRewards');
  const result = await processReferralRewards(serverDB, input.userId);
  if (result.awardedCount > 0) {
    console.info(
      `[tg-link] referral rewards: awarded=${result.awardedCount} total=${result.totalCredits}cr referee=${input.userId}`,
    );
  }
} catch (e) {
  console.error('[tg-link] processReferralRewards failed', e);
}
```

- [ ] **Step 5: Type check + commit**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
npx tsc --noEmit 2>&1 | grep -E 'referrals|telegram-link|fulfill' | head -10 || echo OK
git add src/server/modules/referrals/processReferralRewards.ts \
  src/server/modules/billing/fulfill.ts \
  src/libs/better-auth/hooks/telegram-link.ts
# Note: git mv already staged the rename; the file may need re-add if its contents changed.
git add src/server/modules/referrals/
git commit -m "feat(referrals): switch reward trigger to TG-link + bonus pool"
```

Expected: tsc OK; commit lands.

---

## Task 2: Remove +20 welcome bonus from `onSignup.ts`

Per spec, no welcome bonus. Existing `processReferralSignup` adds 20 credits to `tokenBalance` of every referred user. Remove.

**Files:**

- Modify: `src/server/modules/referrals/onSignup.ts`

- [ ] **Step 1: Drop the welcome credits block**

Read `src/server/modules/referrals/onSignup.ts`. Find the block that uses `REFERRAL_WELCOME_CREDITS` (search for the constant). Remove the export, the constant, and the SQL/Drizzle write that credits `tokenBalance`.

Replace with this comment near the spot where credits used to go:

```ts
// (No referee welcome bonus on signup — the +100 bonus is granted
//  later when they link Telegram, via processReferralRewards.)
```

- [ ] **Step 2: Update onSignup tests**

In `src/server/modules/referrals/__tests__/onSignup.test.ts`, remove any assertions that check for the +20 credit. Keep all the other assertions (referrals rows created, referred_by_l1/l2 set, anti-abuse gates).

Run:

```bash
npx vitest run src/server/modules/referrals/__tests__/onSignup.test.ts 2>&1 | tail -10
```

Expected: all tests pass (or skip cleanly if DB env not set, same pattern as `grantTgLinkBonus.test.ts`).

- [ ] **Step 3: Commit**

```bash
git add src/server/modules/referrals/onSignup.ts \
  src/server/modules/referrals/__tests__/onSignup.test.ts
git commit -m "feat(referrals): drop +20 welcome — bonus moves to TG-link trigger"
```

---

## Task 3: TDD `processReferralRewards.ts`

Write a fresh integration test for the new rewards module (the old `rewardOnFirstPayment` had no test).

**Files:**

- Create: `src/server/modules/referrals/__tests__/processReferralRewards.test.ts`

- [ ] **Step 1: Write the test file**

Mirror the structure of `src/server/modules/billing/__tests__/grant-tg-link-bonus.test.ts` — describe.skip when env is missing, otherwise real lobe-postgres:

```ts
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import {
  L1_REFEREE_CREDITS,
  L1_REFERRER_CREDITS,
  L2_REFERRER_CREDITS,
  processReferralRewards,
} from '../processReferralRewards';

const TEST_DB_URL =
  process.env.DATABASE_TEST_URL ||
  (process.env.POSTGRES_PASSWORD
    ? `postgresql://postgres:${process.env.POSTGRES_PASSWORD}@127.0.0.1:5433/lobechat`
    : undefined);

const describeIfDb = TEST_DB_URL ? describe : describe.skip;

const NS = 'test-refrwd-' + Date.now();
const REFERRER = `${NS}-referrer`;
const L2_REFERRER = `${NS}-l2`;
const REFEREE = `${NS}-referee`;

async function seedUser(db: LobeChatDatabase, id: string, referredByL1?: string) {
  await db.insert(schema.users).values({
    id,
    email: id + '@test.local',
    emailVerified: false,
    referredByL1: referredByL1 ?? null,
  });
}

async function cleanup(db: LobeChatDatabase) {
  // Delete in FK order: referrals → user_billing → users
  for (const uid of [REFEREE, REFERRER, L2_REFERRER]) {
    await db.delete(schema.referrals).where(eq(schema.referrals.referredUserId, uid));
    await db.delete(schema.referrals).where(eq(schema.referrals.referrerUserId, uid));
    await db.delete(schema.userBilling).where(eq(schema.userBilling.userId, uid));
    await db.delete(schema.users).where(eq(schema.users.id, uid));
  }
}

describeIfDb('processReferralRewards (real DB)', () => {
  let pool: Pool;
  let db: LobeChatDatabase;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL! });
    db = drizzle(pool, { schema }) as unknown as LobeChatDatabase;
  });

  afterAll(async () => {
    await cleanup(db);
    await pool.end();
  });

  beforeEach(async () => {
    await cleanup(db);
  });

  it('L1 only: rewards referrer + referee, flips status', async () => {
    await seedUser(db, REFERRER);
    await seedUser(db, REFEREE, REFERRER);
    await db.insert(schema.referrals).values({
      referrerUserId: REFERRER,
      referredUserId: REFEREE,
      level: 1,
      status: 'pending',
    });

    const result = await processReferralRewards(db, REFEREE);
    expect(result.awardedCount).toBe(1);
    expect(result.totalCredits).toBe(L1_REFERRER_CREDITS + L1_REFEREE_CREDITS);

    const [refRow] = await db
      .select()
      .from(schema.referrals)
      .where(eq(schema.referrals.referredUserId, REFEREE));
    expect(refRow.status).toBe('rewarded');
    expect(refRow.creditsAwarded).toBe(L1_REFERRER_CREDITS);

    const [referrerBilling] = await db
      .select()
      .from(schema.userBilling)
      .where(eq(schema.userBilling.userId, REFERRER));
    expect(referrerBilling.bonusBalance).toBe(L1_REFERRER_CREDITS);
    expect(referrerBilling.bonusBalanceExpiresAt).not.toBeNull();

    const [refereeBilling] = await db
      .select()
      .from(schema.userBilling)
      .where(eq(schema.userBilling.userId, REFEREE));
    expect(refereeBilling.bonusBalance).toBe(L1_REFEREE_CREDITS);
  });

  it('L1 + L2: rewards both levels in one pass', async () => {
    await seedUser(db, L2_REFERRER);
    await seedUser(db, REFERRER, L2_REFERRER);
    await seedUser(db, REFEREE, REFERRER);
    await db.insert(schema.referrals).values([
      { referrerUserId: REFERRER, referredUserId: REFEREE, level: 1, status: 'pending' },
      { referrerUserId: L2_REFERRER, referredUserId: REFEREE, level: 2, status: 'pending' },
    ]);

    const result = await processReferralRewards(db, REFEREE);
    expect(result.awardedCount).toBe(2);
    expect(result.totalCredits).toBe(
      L1_REFERRER_CREDITS + L1_REFEREE_CREDITS + L2_REFERRER_CREDITS,
    );

    const [l2Billing] = await db
      .select()
      .from(schema.userBilling)
      .where(eq(schema.userBilling.userId, L2_REFERRER));
    expect(l2Billing.bonusBalance).toBe(L2_REFERRER_CREDITS);
  });

  it('idempotent: second call does nothing', async () => {
    await seedUser(db, REFERRER);
    await seedUser(db, REFEREE, REFERRER);
    await db.insert(schema.referrals).values({
      referrerUserId: REFERRER,
      referredUserId: REFEREE,
      level: 1,
      status: 'pending',
    });

    await processReferralRewards(db, REFEREE);
    const second = await processReferralRewards(db, REFEREE);
    expect(second.awardedCount).toBe(0);

    const [referrerBilling] = await db
      .select()
      .from(schema.userBilling)
      .where(eq(schema.userBilling.userId, REFERRER));
    expect(referrerBilling.bonusBalance).toBe(L1_REFERRER_CREDITS); // not doubled
  });

  it('no pending referrals: no-op', async () => {
    await seedUser(db, REFEREE);
    const result = await processReferralRewards(db, REFEREE);
    expect(result.awardedCount).toBe(0);
    expect(result.totalCredits).toBe(0);
  });
});
```

- [ ] **Step 2: Run with DB env**

```bash
POSTGRES_PASSWORD=$(grep '^POSTGRES_PASSWORD=' /opt/lobechat/.env | cut -d= -f2- | tr -d "'\"") \
  npx vitest run src/server/modules/referrals/__tests__/processReferralRewards.test.ts 2>&1 | tail -15
```

Expected: 4/4 passed.

- [ ] **Step 3: Commit**

```bash
git add src/server/modules/referrals/__tests__/processReferralRewards.test.ts
git commit -m "test(referrals): processReferralRewards real-DB integration tests"
```

---

## Task 4: Add Next.js middleware to capture `?ref=CODE`

**Files:**

- Create: `src/middleware.ts`

- [ ] **Step 1: Create the middleware**

```ts
// src/middleware.ts
/**
 * Capture `?ref=CODE` on direct visits to ask.gptweb.ru. Sets the `_ref`
 * cookie (8-char lowercase alnum) and 302's to the same URL without the
 * query param so it doesn't pollute history. The cookie is read later by
 * processReferralSignup() in the Better Auth user.create.after hook.
 *
 * Cookie config:
 *   - 30-day TTL (matches reward expiry).
 *   - sameSite=lax so it survives the cross-tab signup form submit.
 *   - secure on https.
 *   - httpOnly to keep JS off it.
 *
 * Anything other than the `ref` param is untouched.
 */
import { type NextRequest, NextResponse } from 'next/server';

const COOKIE_NAME = '_ref';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

export function middleware(req: NextRequest) {
  const ref = req.nextUrl.searchParams.get('ref');
  if (!ref) return NextResponse.next();

  // Validate shape — same regex onSignup uses to read the cookie.
  if (!/^[a-z0-9]{8}$/i.test(ref)) return NextResponse.next();

  const cleanUrl = req.nextUrl.clone();
  cleanUrl.searchParams.delete('ref');
  const res = NextResponse.redirect(cleanUrl, 302);
  res.cookies.set(COOKIE_NAME, ref.toLowerCase(), {
    httpOnly: true,
    maxAge: COOKIE_MAX_AGE,
    path: '/',
    sameSite: 'lax',
    secure: true,
  });
  return res;
}

// Only run on paths likely to carry `?ref=` — root + a few entry routes.
// Avoid running on tRPC / API / Next internals.
export const config = {
  matcher: ['/', '/((?!api|trpc|_next|favicon|robots|sitemap|images|fonts|admin).*)'],
};
```

- [ ] **Step 2: Sanity check matcher doesn't break existing routes**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
npx tsc --noEmit 2>&1 | grep middleware || echo OK
```

Expected: `OK`. Manual test post-deploy (see Task 9).

- [ ] **Step 3: Commit**

```bash
git add src/middleware.ts
git commit -m "feat(referrals): middleware captures ?ref=CODE to _ref cookie"
```

---

## Task 5: Partial UNIQUE index migration

**Files:**

- Create: `packages/database/migrations/0106_referrals_unique.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0106_referrals_unique.sql
--
-- Prevent two referrers from claiming the same referee at the same level.
-- Partial index excludes 'rejected' rows so admins can mark fraud
-- referrals rejected without locking out a legit re-attempt.
CREATE UNIQUE INDEX IF NOT EXISTS referrals_referred_level_unique
  ON referrals (referred_user_id, level)
  WHERE status != 'rejected';
```

- [ ] **Step 2: Manually apply on prod DB**

```bash
docker exec lobe-postgres psql -U postgres -d lobechat -c "$(cat packages/database/migrations/0106_referrals_unique.sql)" 2>&1 | grep -v -E 'WARNING|DETAIL|HINT|collation'
```

Expected: `CREATE INDEX`.

- [ ] **Step 3: Stamp drizzle journal**

```bash
HASH=$(sha256sum packages/database/migrations/0106_referrals_unique.sql | awk '{print $1}')
TS=$(date +%s)000
docker exec lobe-postgres psql -U postgres -d lobechat -c "
INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at)
VALUES (120, '$HASH', $TS);
"
```

Expected: `INSERT 0 1`. Container can now restart without re-running migration.

- [ ] **Step 4: Commit**

```bash
git add packages/database/migrations/0106_referrals_unique.sql
git commit -m "feat(referrals): partial unique index on (referred_user_id, level)"
```

---

## Task 6: Backfill NULL `referral_code`

**Files:** none — ops SQL only.

- [ ] **Step 1: Check how many rows are affected**

```bash
docker exec lobe-postgres psql -U postgres -d lobechat -tA -c "
SELECT COUNT(*) AS null_codes FROM users WHERE referral_code IS NULL;
" 2>&1 | grep -v -E 'WARNING|DETAIL|HINT|collation'
```

If 0 → skip the next step.

- [ ] **Step 2: Backfill if non-zero**

```bash
docker exec lobe-postgres psql -U postgres -d lobechat -c "
UPDATE users
SET referral_code = lower(substr(md5(id || 'salt-2026-05-24'), 1, 8)),
    updated_at = NOW()
WHERE referral_code IS NULL;
"
```

Expected: `UPDATE N`. Codes are lowercase 8-char hex (matches `onSignup.ts` regex `[a-z0-9]{8}`).

---

## Task 7: Referral.tsx UI — surface code + sharing

**Files:**

- Modify: `src/business/client/BusinessSettingPages/Referral/index.tsx` (and any sibling Referral.tsx wrapper)

- [ ] **Step 1: Read the existing page**

```bash
cat src/business/client/BusinessSettingPages/Referral/index.tsx | head -80
```

Note the existing imports, the tRPC query for stats, the cashout modal hook-up (which we will remove).

- [ ] **Step 2: Edits**

In the file:

1. Remove the import + render of `CashoutModal` (cashout stays dormant per spec non-goal).
2. Add a prominent share section at top:

```tsx
// Inside the main component, before the existing stats block:
{
  stats?.referralCode && (
    <Block padding={16} variant="filled">
      <Flexbox gap={12}>
        <div style={{ fontWeight: 600 }}>Твоя реф-ссылка</div>
        <Flexbox horizontal gap={8} align="center">
          <Input
            readOnly
            value={`https://ask.gptweb.ru/?ref=${stats.referralCode}`}
            onClick={(e) => e.currentTarget.select()}
          />
          <Button
            type="primary"
            onClick={() => {
              void navigator.clipboard.writeText(
                `https://ask.gptweb.ru/?ref=${stats.referralCode}`,
              );
              message.success('Скопировано');
            }}
          >
            Копировать
          </Button>
        </Flexbox>
        <Flexbox horizontal gap={8}>
          <Button
            type="default"
            href={`https://t.me/share/url?url=${encodeURIComponent(
              `https://ask.gptweb.ru/?ref=${stats.referralCode}`,
            )}&text=${encodeURIComponent('Попробуй WebGPT — GPT, Claude, Gemini в одном окне. По моей ссылке +100 кредитов.')}`}
            target="_blank"
          >
            В Telegram
          </Button>
          <Button
            type="default"
            href={`https://vk.com/share.php?url=${encodeURIComponent(
              `https://ask.gptweb.ru/?ref=${stats.referralCode}`,
            )}`}
            target="_blank"
          >
            ВКонтакте
          </Button>
          <Button
            type="default"
            href={`https://wa.me/?text=${encodeURIComponent(
              `Попробуй WebGPT — https://ask.gptweb.ru/?ref=${stats.referralCode}`,
            )}`}
            target="_blank"
          >
            WhatsApp
          </Button>
        </Flexbox>
        <div style={{ color: '#666', fontSize: 13 }}>
          За каждого друга, кто зарегается и привяжет Telegram — <b>+100 кр обоим</b> на 30 дней.
          Если друг приведёт ещё одного — ты получишь <b>+30 кр</b> с L2.
        </div>
      </Flexbox>
    </Block>
  );
}
```

Imports to add: `Input`, `message` from `antd` if not already imported.

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | grep -E 'Referral' | head -5
git add src/business/client/BusinessSettingPages/Referral/
git commit -m "feat(referrals): UI — share link + buttons, hide cashout"
```

---

## Task 8: CreditsExhaustedModal — add referral CTA

**Files:**

- Modify: `src/components/CreditsExhaustedModal/CreditsExhaustedModal.tsx`

- [ ] **Step 1: Read existing modal**

Skim — identify where the "Купить тариф" button lives.

- [ ] **Step 2: Add referral CTA next to it**

Inside the modal body, alongside the existing subscribe button, add:

```tsx
<Button
  size="large"
  onClick={() => {
    router.push('/settings/referral');
    onCancel();
  }}
>
  🎁 Пригласить друга — +100 кр
</Button>
```

Imports: `useRouter` from `next/navigation` if not already present.

- [ ] **Step 3: Commit**

```bash
git add src/components/CreditsExhaustedModal/CreditsExhaustedModal.tsx
git commit -m "feat(ui): CreditsExhaustedModal — referral CTA next to upgrade"
```

---

## Task 9: Ops — deploy + smoke

- [ ] **Step 1: Push + build**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
git push origin canary
docker build -t lobechat-custom:latest .
cd /opt/lobechat && docker compose up -d lobe
sleep 18
docker ps --filter name=lobehub --format '{{.Status}}'
curl -s --max-time 5 --resolve ask.gptweb.ru:443:135.181.115.234 -o /dev/null -w '/ : %{http_code}\n' https://ask.gptweb.ru/
```

Expected: container `Up`, `/` returns 200.

- [ ] **Step 2: Middleware smoke**

```bash
curl -s --max-time 5 --resolve ask.gptweb.ru:443:135.181.115.234 -I "https://ask.gptweb.ru/?ref=abcd1234" 2>&1 | head -10
```

Expected: `302 Found` + `Set-Cookie: _ref=abcd1234;` header. Trying again without the param should NOT set the cookie.

- [ ] **Step 3: Pick a real test referrer + create a referee**

```bash
docker exec lobe-postgres psql -U postgres -d lobechat -tA -c "
SELECT id, email, referral_code FROM users WHERE id = '48b6e949-0eec-4601-868a-8efe36b81260';
" 2>&1 | grep -v -E 'WARNING|DETAIL|HINT|collation'
```

Use the printed `referral_code` (e.g. `xxxx1234`). Open `https://ask.gptweb.ru/?ref=<code>` in an incognito browser. Verify cookie via DevTools.

- [ ] **Step 4: Sign up a fresh test user via email + verify DB state**

After registration in the incognito session:

```bash
docker exec lobe-postgres psql -U postgres -d lobechat -tA -c "
SELECT u.id, u.email, u.referred_by_l1, u.referred_by_l2,
       (SELECT COUNT(*) FROM referrals r WHERE r.referred_user_id = u.id) AS ref_rows
FROM users u
WHERE u.created_at > NOW() - INTERVAL '5 minutes'
ORDER BY u.created_at DESC
LIMIT 3;
" 2>&1 | grep -v -E 'WARNING|DETAIL|HINT|collation'
```

Expected: the new user has `referred_by_l1` = the referrer's ID and 1 (or 2 if L2) `referrals` row(s) with status='pending'.

- [ ] **Step 5: Link Telegram from the test session and verify rewards**

In the incognito session, link Telegram via banner (the feature is currently disabled — re-enable for this test by flipping `BANNER_TEMPORARILY_DISABLED = false` in `useShouldShow.ts`, rebuilding, then flipping back).

If easier: call the link-confirm endpoint manually with a test TG-account flow. After link:

```bash
docker exec lobe-postgres psql -U postgres -d lobechat -tA -c "
SELECT r.id, r.level, r.status, r.credits_awarded, r.rewarded_at
FROM referrals r
WHERE r.referred_user_id = '<new_user_id>';
"
```

Expected: status='rewarded', credits_awarded=100 (L1) and/or 30 (L2). Verify `bonus_balance` on both referrer and referee.

- [ ] **Step 6: Self-invite smoke**

Open `https://ask.gptweb.ru/?ref=<your_own_code>` in incognito, sign up with a fresh email. Expected: no `referrals` row created (anti-self-refer in onSignup blocks it).

---

## Self-Review

**Spec coverage:**

- ✅ Architecture (cookie → signup → TG-link reward) — Tasks 1, 4
- ✅ Data Model (existing schema, partial unique index) — Task 5
- ✅ Backfill — Task 6
- ✅ File Map (all entries addressed in tasks) ✓
- ✅ Anti-Fraud — disposable email, self-refer, IP velocity already in `antiAbuse.ts` (existing). Tasks reuse.
- ✅ Testing — Task 3 covers `processReferralRewards`; Task 2 updates `onSignup.test.ts`.
- ✅ Rollout — Task 9.

**Placeholder scan:** none. Every step has concrete code or commands.

**Type consistency:**

- `L1_REFERRER_CREDITS = 100`, `L1_REFEREE_CREDITS = 100`, `L2_REFERRER_CREDITS = 30` consistent across Task 1 + Task 3 ✓
- `bonus_balance` + `bonus_balance_expires_at` matches schema reused from TG-link feature ✓
- Cookie name `_ref` lowercase, 8-char `[a-z0-9]` shape consistent in `onSignup.ts`, middleware ✓

**Divergence from spec to flag:**

- Spec listed file `record-pending.ts` as separate from `onSignup.ts` — in reality the existing `onSignup.ts` already does both jobs (record pending + capture cookie + anti-abuse). The plan reuses it; no new `record-pending.ts` file.
- Spec listed `capture-ref-cookie.ts` as new file — in reality `onSignup.ts` already has `readRefCookie()` + cookie-resolve logic inline. The plan doesn't add the separate file (YAGNI).
