# Light / Pro UI Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-user runtime UI mode toggle (Light/Pro) so casual users see a clean ChatGPT-like surface while power users keep the full LobeChat experience — both backed by the exact same backend.

**Architecture:** Single new column `user_onboarding.ui_mode`. Existing `userOnboarding` tRPC router gets `setUiMode` mutation. Client store reads the mode and conditionally filters the provider list (light → only `lobehub` provider), the sidebar items (light → 5 items), and the settings menu (light → 8 items). A new `<UIModeToggle />` segmented control in the top-bar drives the mutation. The build-time `NEXT_PUBLIC_SIMPLE_UI` flag from Task 1.2 gets fully reverted; runtime per-user `ui_mode` replaces it.

**Tech Stack:** Next.js 16, TypeScript, Drizzle ORM, PostgreSQL, tRPC, Zustand, Ant Design, lucide-react, vitest.

**Spec:** `docs/superpowers/specs/2026-04-25-light-pro-modes-design.md`

---

## File map

| Path                                                                                  | Action                             | Responsibility                                                                                             |
| ------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `packages/database/migrations/0091_user_onboarding_ui_mode.sql`                       | Create                             | Add `ui_mode` column + backfill all existing rows to `'light'`                                             |
| `packages/database/migrations/meta/_journal.json`                                     | Modify                             | Append journal entry for migration 0091                                                                    |
| `packages/database/src/schemas/userOnboarding.ts`                                     | Modify                             | Add `uiMode` field with Drizzle column definition                                                          |
| `src/business/server/lambda-routers/userOnboarding.ts`                                | Modify                             | Add `setUiMode` mutation; existing `getOnboardingState` already returns the new column for free            |
| `src/business/server/lambda-routers/__tests__/userOnboarding.test.ts`                 | Create                             | Test the new mutation + that getOnboardingState returns ui_mode                                            |
| `src/store/user/slices/onboarding/initialState.ts`                                    | Modify (or create slice if absent) | Local store mirrors `ui_mode` state                                                                        |
| `src/store/user/slices/onboarding/action.ts`                                          | Modify (or create)                 | `setUiMode` action: optimistic update + tRPC call + toast                                                  |
| `src/store/user/slices/onboarding/selectors.ts`                                       | Modify (or create)                 | `currentUiMode` selector                                                                                   |
| `src/features/UIMode/UIModeToggle.tsx`                                                | Create                             | Segmented control component, mounted in top-bar                                                            |
| `src/features/UIMode/index.ts`                                                        | Create                             | Barrel export                                                                                              |
| `src/store/aiInfra/slices/aiProvider/selectors.ts`                                    | Modify                             | New selectors: `enabledAiProviderListByMode`, `enabledImageModelListByMode`, `enabledVideoModelListByMode` |
| `src/app/[variants]/(main)/home/_layout/Header/components/Nav.tsx`                    | Modify                             | Replace `featureFlags.isSimpleUI` reads with `useCurrentUiMode()` hook                                     |
| `src/app/[variants]/(main)/home/_layout/Body/BottomMenu/index.tsx`                    | Modify                             | Same conversion                                                                                            |
| `src/features/MobileTabBar/index.tsx`                                                 | Modify                             | Same conversion + add Pricing/Image/Video tabs in light                                                    |
| `src/app/[variants]/(main)/settings/hooks/useCategory.tsx`                            | Modify                             | Use ui_mode to filter to 8-item allowlist                                                                  |
| `src/app/[variants]/(main)/settings/provider/_layout/Container.tsx` (or page wrapper) | Modify                             | Redirect to /settings/profile when light                                                                   |
| `src/features/UIMode/LockedModelTooltip.tsx`                                          | Create                             | Wraps model entry with 🔒 + onClick → upsell                                                               |
| `src/features/UIMode/UpsellModal.tsx`                                                 | Create                             | Modal: "Доступно в плане X за Y₽/мес" + CTA                                                                |
| `src/features/Onboarding/WelcomeModal.tsx`                                            | Modify                             | New body copy mentioning Pro toggle                                                                        |
| `src/locales/default/onboarding.ts`                                                   | Modify                             | New strings: `welcome.bodyLight`, `uiMode.toggle.*`, `upsellModal.*`                                       |
| `src/locales/ru-RU/onboarding.json`                                                   | Modify                             | Russian translations                                                                                       |
| `src/locales/en-US/onboarding.json`                                                   | Modify                             | English translations                                                                                       |
| `Dockerfile`                                                                          | Modify                             | Remove `ARG NEXT_PUBLIC_SIMPLE_UI` and `ENV NEXT_PUBLIC_SIMPLE_UI=...`                                     |
| `.env.example`                                                                        | Modify                             | Remove `NEXT_PUBLIC_SIMPLE_UI` block                                                                       |
| `/opt/lobechat/.env`                                                                  | Modify (manual op)                 | Remove `NEXT_PUBLIC_SIMPLE_UI=true` line on VPS                                                            |
| `src/config/featureFlags/schema.ts`                                                   | Modify                             | Remove `readSimpleUIFlag()` and `isSimpleUI` field                                                         |

---

## Task 1: DB migration — add ui_mode column

**Files:**

- Create: `packages/database/migrations/0091_user_onboarding_ui_mode.sql`

- Modify: `packages/database/migrations/meta/_journal.json` (append entry)

- Modify: `packages/database/src/schemas/userOnboarding.ts`

- [ ] **Step 1: Write the migration SQL**

Create `packages/database/migrations/0091_user_onboarding_ui_mode.sql`:

```sql
ALTER TABLE "user_onboarding" ADD COLUMN "ui_mode" varchar(8) DEFAULT 'light' NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_onboarding" ADD CONSTRAINT "user_onboarding_ui_mode_check" CHECK ("ui_mode" IN ('light', 'pro'));
--> statement-breakpoint
UPDATE "user_onboarding" SET "ui_mode" = 'light' WHERE "ui_mode" IS NULL;
```

- [ ] **Step 2: Add journal entry**

Open `packages/database/migrations/meta/_journal.json`. Append to `entries` array (use a Unix-ms timestamp roughly equal to `Date.now()` at the time of writing — pick the next millisecond after the last entry; example value below):

```json
{
  "breakpoints": true,
  "idx": 91,
  "tag": "0091_user_onboarding_ui_mode",
  "version": "7",
  "when": 1777800000000
}
```

- [ ] **Step 3: Update Drizzle schema**

Modify `packages/database/src/schemas/userOnboarding.ts`. Add `varchar` import + the new column:

```ts
import { boolean, pgTable, text, varchar } from 'drizzle-orm/pg-core';

import { timestamptz } from './_helpers';
import { users } from './user';

export const userOnboarding = pgTable('user_onboarding', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  firstLoginSeen: boolean('first_login_seen').notNull().default(false),
  firstMessageSeen: boolean('first_message_seen').notNull().default(false),
  firstToastSeen: boolean('first_toast_seen').notNull().default(false),
  uiMode: varchar('ui_mode', { length: 8 }).notNull().default('light').$type<'light' | 'pro'>(),
  bannerDismissedAt: timestamptz('banner_dismissed_at'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type UserOnboardingItem = typeof userOnboarding.$inferSelect;
export type NewUserOnboarding = typeof userOnboarding.$inferInsert;
export type UiMode = 'light' | 'pro';
```

- [ ] **Step 4: Apply the migration on the VPS lobe-postgres container**

Run on VPS#1 (where the prod DB lives):

```bash
docker cp /home/deploy/projects/ai-aggregator-lobechat/packages/database/migrations/0091_user_onboarding_ui_mode.sql lobe-postgres:/tmp/0091.sql
docker exec lobe-postgres psql -U postgres -d lobechat -f /tmp/0091.sql
```

Expected: `ALTER TABLE`, `ALTER TABLE`, `UPDATE N` where N = current row count of user_onboarding.

- [ ] **Step 5: Register the migration in `__drizzle_migrations`**

Drizzle tracks migrations by hash. Without this row, the next aggregator boot will try to re-apply 0091 and fail with "ui_mode column already exists". Compute the hash and insert:

```bash
HASH=$(sha256sum /home/deploy/projects/ai-aggregator-lobechat/packages/database/migrations/0091_user_onboarding_ui_mode.sql | awk '{print $1}')
docker exec lobe-postgres psql -U postgres -d lobechat -c "
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
VALUES ('$HASH', extract(epoch from now()) * 1000)
ON CONFLICT DO NOTHING;
SELECT id, left(hash, 16) AS hash_prefix FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 3;
"
```

Expected: a new row with id one higher than before (likely 92), and the previous Task 1.3 entry visible.

- [ ] **Step 6: Verify the schema**

```bash
docker exec lobe-postgres psql -U postgres -d lobechat -c "
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name='user_onboarding' AND column_name='ui_mode';
SELECT count(*) AS total, count(*) FILTER (WHERE ui_mode='light') AS light
FROM user_onboarding;
"
```

Expected: one row showing `ui_mode | character varying | 'light' | NO`, then totals where total = light.

- [ ] **Step 7: Commit**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
git -c user.name=pasha -c user.email=2396741@gmail.com add \
  packages/database/migrations/0091_user_onboarding_ui_mode.sql \
  packages/database/migrations/meta/_journal.json \
  packages/database/src/schemas/userOnboarding.ts
git -c user.name=pasha -c user.email=2396741@gmail.com commit -m "feat(db): add ui_mode column to user_onboarding (Light/Pro modes)"
```

---

## Task 2: tRPC `setUiMode` mutation + tests

**Files:**

- Modify: `src/business/server/lambda-routers/userOnboarding.ts`

- Create: `src/business/server/lambda-routers/__tests__/userOnboarding.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/business/server/lambda-routers/__tests__/userOnboarding.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

import { userOnboarding } from '@/database/schemas';

import { userOnboardingRouter } from '../userOnboarding';

describe('userOnboardingRouter.setUiMode', () => {
  const fakeUserId = 'test-user-1';
  const updates: { mode: string }[] = [];

  const fakeDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ userId: fakeUserId, uiMode: 'light' }],
        }),
      }),
    }),
    insert: () => ({ values: () => ({ onConflictDoNothing: () => Promise.resolve() }) }),
    update: () => ({
      set: (patch: any) => ({
        where: async () => {
          updates.push({ mode: patch.uiMode });
        },
      }),
    }),
  };

  beforeEach(() => {
    updates.length = 0;
  });

  it('persists ui_mode=pro when called with "pro"', async () => {
    const caller = userOnboardingRouter.createCaller({
      serverDB: fakeDb as any,
      userId: fakeUserId,
    } as any);
    const res = await caller.setUiMode({ mode: 'pro' });
    expect(res).toEqual({ ok: true, uiMode: 'pro' });
    expect(updates).toEqual([{ mode: 'pro' }]);
  });

  it('rejects invalid modes via zod schema', async () => {
    const caller = userOnboardingRouter.createCaller({
      serverDB: fakeDb as any,
      userId: fakeUserId,
    } as any);
    await expect(caller.setUiMode({ mode: 'turbo' as any })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
npx pnpm test --run src/business/server/lambda-routers/__tests__/userOnboarding.test.ts
```

Expected: FAIL — "setUiMode is not a function".

- [ ] **Step 3: Add the mutation**

Modify `src/business/server/lambda-routers/userOnboarding.ts`. Add `z` import, then a new procedure inside `userOnboardingRouter`:

```ts
import { z } from 'zod';
// ... existing imports ...

const uiModeSchema = z.object({ mode: z.enum(['light', 'pro']) });

export const userOnboardingRouter = router({
  // ... existing procedures ...
  setUiMode: onboardingProcedure.input(uiModeSchema).mutation(async ({ ctx, input }) => {
    await fetchOrCreate(ctx.serverDB, ctx.userId);
    await ctx.serverDB
      .update(userOnboarding)
      .set({ uiMode: input.mode, updatedAt: new Date() })
      .where(eq(userOnboarding.userId, ctx.userId));
    return { ok: true, uiMode: input.mode };
  }),
});
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
npx pnpm test --run src/business/server/lambda-routers/__tests__/userOnboarding.test.ts
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git -c user.name=pasha -c user.email=2396741@gmail.com add \
  src/business/server/lambda-routers/userOnboarding.ts \
  src/business/server/lambda-routers/__tests__/userOnboarding.test.ts
git -c user.name=pasha -c user.email=2396741@gmail.com commit -m "feat(trpc): add userOnboarding.setUiMode mutation"
```

---

## Task 3: Revert `NEXT_PUBLIC_SIMPLE_UI` build-time flag

This must happen BEFORE adding the new runtime flag, otherwise the four conditional renders from Task 1.2 will misbehave when both flags exist.

**Files:**

- Modify: `src/config/featureFlags/schema.ts`

- Modify: `src/app/[variants]/(main)/home/_layout/Header/components/Nav.tsx`

- Modify: `src/app/[variants]/(main)/home/_layout/Body/BottomMenu/index.tsx`

- Modify: `src/features/MobileTabBar/index.tsx`

- Modify: `src/app/[variants]/(main)/settings/hooks/useCategory.tsx`

- Modify: `src/app/[variants]/layout.tsx`

- Modify: `src/styles/index.ts`

- Delete: `src/styles/customSimple.ts`

- Modify: `Dockerfile`

- Modify: `.env.example`

- [ ] **Step 1: Remove the schema field**

Open `src/config/featureFlags/schema.ts`. Delete the `readSimpleUIFlag` function (lines 62-71) and the `isSimpleUI: readSimpleUIFlag(),` field (line \~132).

- [ ] **Step 2: Remove conditional renders in nav/menu/sidebar**

For each of the four files below, remove the `isSimpleUI` reads and the conditional logic they gate. Restore the unconditional rendering that existed before Task 1.2.

In `src/app/[variants]/(main)/home/_layout/Header/components/Nav.tsx`: revert the `&& !isSimpleUI` filters on Discover/Image/Video/Pages; remove the `useFeatureFlags` or `getFeatureFlags` call that fetches `isSimpleUI`.

In `src/app/[variants]/(main)/home/_layout/Body/BottomMenu/index.tsx`: same — remove the Resource/Memory hide logic.

In `src/features/MobileTabBar/index.tsx`: same — remove the Discover hide logic.

In `src/app/[variants]/(main)/settings/hooks/useCategory.tsx`: same — remove the Skill/TTS/Memory/Image hide logic.

If a single git revert can pull this off cleanly (without touching the Onboarding work that landed afterwards), prefer:

```bash
git revert da2f8df9f7 --no-commit
git status  # verify only Task 1.2 files affected
git checkout HEAD -- <any onboarding files accidentally included>
```

If `git revert` produces conflicts with later commits, fall back to manual edits per the bullets above.

- [ ] **Step 3: Remove the layout `data-simple-ui` attribute and customSimple stylesheet**

In `src/app/[variants]/layout.tsx`: remove the `data-simple-ui` attribute on `<html>` and the related logic that sets it.

In `src/styles/index.ts`: remove the `customSimple()` import and call from `GlobalStyle`.

Delete `src/styles/customSimple.ts` (the empty fallback file).

- [ ] **Step 4: Remove the build-arg from Dockerfile**

In `Dockerfile`, delete the two lines:

```dockerfile
ARG NEXT_PUBLIC_SIMPLE_UI
```

and

```dockerfile
# Simple UI feature flag (Task 1.2)
ENV NEXT_PUBLIC_SIMPLE_UI="${NEXT_PUBLIC_SIMPLE_UI}"
```

- [ ] **Step 5: Remove `.env.example` block**

In `.env.example`, delete the `NEXT_PUBLIC_SIMPLE_UI=...` line and any explanatory comment block above it.

- [ ] **Step 6: Verify nothing references SIMPLE_UI anymore**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
grep -rn "SIMPLE_UI\|isSimpleUI\|customSimple\|simple-ui" src/ packages/ Dockerfile .env.example 2> /dev/null
```

Expected: 0 hits.

- [ ] **Step 7: Commit**

```bash
git -c user.name=pasha -c user.email=2396741@gmail.com add -A
git -c user.name=pasha -c user.email=2396741@gmail.com commit -m "revert: NEXT_PUBLIC_SIMPLE_UI build-time flag (replaced by runtime ui_mode)"
```

- [ ] **Step 8: Manual: remove env var on VPS**

User performs once after deploy:

```bash
sed -i '/^NEXT_PUBLIC_SIMPLE_UI=/d' /opt/lobechat/.env
```

---

## Task 4: Client store slice for `uiMode`

LobeChat already has a `userStore` with sub-slices. We add a small set of additions for ui_mode.

**Files:**

- Modify: `src/store/user/slices/onboarding/initialState.ts` (or create the file if absent — search first)
- Modify: `src/store/user/slices/onboarding/action.ts`
- Modify: `src/store/user/slices/onboarding/selectors.ts`

If the path doesn't exist, locate where `firstLoginSeen` is read on the client (search `markFirstLoginSeen`), and put the new state there.

- [ ] **Step 1: Confirm where existing onboarding state lives client-side**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
grep -rln "firstLoginSeen\|markFirstLoginSeen\|getOnboardingState" src/store src/features/Onboarding 2> /dev/null
```

Note the slice path. If `src/store/user/slices/onboarding/` doesn't exist, then onboarding state is consumed inline via SWR/tRPC inside `src/features/Onboarding/*.tsx` — in that case, add a thin Zustand slice at `src/store/user/slices/uiMode/` instead.

- [ ] **Step 2: Add `uiMode` initial state and setter**

Edit (or create) `src/store/user/slices/uiMode/initialState.ts`:

```ts
import type { UiMode } from '@/database/schemas/userOnboarding';

export interface UIModeState {
  uiMode: UiMode;
  uiModeLoading: boolean;
}

export const initialUIModeState: UIModeState = {
  uiMode: 'light',
  uiModeLoading: false,
};
```

Create `src/store/user/slices/uiMode/action.ts`:

```ts
import type { StateCreator } from 'zustand';

import type { UiMode } from '@/database/schemas/userOnboarding';
import { lambdaClient } from '@/libs/trpc/client';

import type { UserStore } from '../../store';
import type { UIModeState } from './initialState';

export interface UIModeAction {
  loadUiMode: () => Promise<void>;
  setUiMode: (mode: UiMode) => Promise<void>;
}

export const createUIModeSlice: StateCreator<UserStore, [], [], UIModeAction & UIModeState> = (
  set,
  get,
) => ({
  ...({} as UIModeState),
  loadUiMode: async () => {
    set({ uiModeLoading: true });
    try {
      const state = await lambdaClient.userOnboarding.getOnboardingState.query();
      const next = (state?.uiMode ?? 'light') as UiMode;
      set({ uiMode: next, uiModeLoading: false });
    } catch (e) {
      console.warn('[uiMode] failed to load, falling back to light', e);
      set({ uiMode: 'light', uiModeLoading: false });
    }
  },
  setUiMode: async (mode) => {
    const prev = get().uiMode;
    set({ uiMode: mode });
    try {
      await lambdaClient.userOnboarding.setUiMode.mutate({ mode });
    } catch (e) {
      // rollback on failure
      set({ uiMode: prev });
      throw e;
    }
  },
});
```

Create `src/store/user/slices/uiMode/selectors.ts`:

```ts
import type { UserStore } from '../../store';

export const uiModeSelectors = {
  current: (s: UserStore) => s.uiMode,
  isLight: (s: UserStore) => s.uiMode === 'light',
  isPro: (s: UserStore) => s.uiMode === 'pro',
  loading: (s: UserStore) => s.uiModeLoading,
};
```

Wire the slice into the user store. Find the file that combines slices (typically `src/store/user/store.ts`) and add:

```ts
import { initialUIModeState } from './slices/uiMode/initialState';
import { createUIModeSlice, type UIModeAction } from './slices/uiMode/action';

// ... in the slice composition:
...createUIModeSlice(set, get, api),
// ... initial state:
...initialUIModeState,
```

Also extend `UserStore` type to include `UIModeAction` and `UIModeState`.

- [ ] **Step 3: Hook to load on app boot**

Find the existing app-boot hook that fires `loadOnboardingState` or similar (search `markFirstLoginSeen` callers). Add `loadUiMode` next to it:

```ts
useEffect(() => {
  useUserStore.getState().loadUiMode();
}, []);
```

If no such boot hook exists, mount the call inside the existing `<WelcomeModal />` or the top layout component that already runs once per session.

- [ ] **Step 4: Commit**

```bash
git -c user.name=pasha -c user.email=2396741@gmail.com add src/store/user/
git -c user.name=pasha -c user.email=2396741@gmail.com commit -m "feat(store): add uiMode slice + loadUiMode/setUiMode actions"
```

---

## Task 5: `<UIModeToggle />` segmented control

**Files:**

- Create: `src/features/UIMode/UIModeToggle.tsx`

- Create: `src/features/UIMode/index.ts`

- Modify: `src/app/[variants]/(main)/home/index.tsx` (or wherever the top-bar is composed — search `BalanceBadge` to find the location used by Task 1.3)

- Modify: `src/locales/default/onboarding.ts`

- Modify: `src/locales/ru-RU/onboarding.json`

- Modify: `src/locales/en-US/onboarding.json`

- [ ] **Step 1: Add i18n strings**

In `src/locales/default/onboarding.ts`, extend the namespace with:

```ts
uiMode: {
  light: 'Light',
  pro: 'Pro',
  switchedToPro: 'Pro mode enabled. All providers and advanced settings unlocked.',
  switchedToLight: 'Light mode enabled. Custom providers hidden.',
  modelResetOnSwitchLight: 'Model switched to WebGPT — other providers are hidden in Light mode',
},
```

In `src/locales/ru-RU/onboarding.json`:

```json
{
  "uiMode": {
    "light": "Light",
    "pro": "Pro",
    "switchedToPro": "Включён Pro режим. Доступны все провайдеры и продвинутые настройки.",
    "switchedToLight": "Включён Light режим. Сторонние провайдеры скрыты.",
    "modelResetOnSwitchLight": "Модель переключена на WebGPT — другие провайдеры скрыты в Light режиме"
  }
}
```

Mirror the structure into `src/locales/en-US/onboarding.json`.

- [ ] **Step 2: Create the toggle component**

Create `src/features/UIMode/UIModeToggle.tsx`:

```tsx
'use client';

import { Segmented } from 'antd';
import { Sparkles, Settings } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { App } from 'antd';

import { useUserStore } from '@/store/user';
import { uiModeSelectors } from '@/store/user/slices/uiMode/selectors';
import type { UiMode } from '@/database/schemas/userOnboarding';

const UIModeToggle = memo(() => {
  const { t } = useTranslation('onboarding');
  const { message } = App.useApp();
  const current = useUserStore(uiModeSelectors.current);
  const setUiMode = useUserStore((s) => s.setUiMode);

  const onChange = useCallback(
    async (value: string | number) => {
      const next = value as UiMode;
      if (next === current) return;
      try {
        await setUiMode(next);
        message.success(next === 'pro' ? t('uiMode.switchedToPro') : t('uiMode.switchedToLight'));
      } catch {
        message.error('Не удалось переключить режим');
      }
    },
    [current, setUiMode, t, message],
  );

  return (
    <Segmented
      value={current}
      onChange={onChange}
      options={[
        { value: 'light', label: t('uiMode.light'), icon: <Sparkles size={14} /> },
        { value: 'pro', label: t('uiMode.pro'), icon: <Settings size={14} /> },
      ]}
      size="small"
    />
  );
});

UIModeToggle.displayName = 'UIModeToggle';

export default UIModeToggle;
```

Create `src/features/UIMode/index.ts`:

```ts
export { default as UIModeToggle } from './UIModeToggle';
```

- [ ] **Step 3: Mount the toggle in the top-bar**

Find the file from Task 1.3 that mounts `<BalanceBadge />` in `NavHeader`:

```bash
grep -rln "BalanceBadge" src/app/ 2> /dev/null | head -3
```

Open that file and add `<UIModeToggle />` immediately to the LEFT of `<BalanceBadge />`:

```tsx
import { UIModeToggle } from '@/features/UIMode';
import { BalanceBadge } from '@/features/Onboarding';

// in the right-side cluster of NavHeader:
<Flexbox horizontal gap={8} align="center">
  <UIModeToggle />
  <BalanceBadge />
  {/* ...existing nav buttons... */}
</Flexbox>;
```

- [ ] **Step 4: Smoke-test the toggle**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
npx pnpm build 2>&1 | tail -5
```

Expected: build succeeds.

Manual test (after deploy is in a later task — for now, just verify TypeScript compiles).

- [ ] **Step 5: Commit**

```bash
git -c user.name=pasha -c user.email=2396741@gmail.com add \
  src/features/UIMode/ \
  src/locales/default/onboarding.ts \
  src/locales/ru-RU/onboarding.json \
  src/locales/en-US/onboarding.json \
  src/app/
git -c user.name=pasha -c user.email=2396741@gmail.com commit -m "feat(ui): UIModeToggle segmented control in top-bar"
```

---

## Task 6: Provider/model selector filters by ui_mode

**Files:**

- Modify: `src/store/aiInfra/slices/aiProvider/selectors.ts`

- [ ] **Step 1: Add the filtered selectors**

Open `src/store/aiInfra/slices/aiProvider/selectors.ts`. Add after the existing `enabledAiProviderList`:

```ts
import type { UiMode } from '@/database/schemas/userOnboarding';

const LOBEHUB_PROVIDER_ID = 'lobehub';

const enabledAiProviderListByMode = (uiMode: UiMode) => (s: AIProviderStoreState) => {
  const all = enabledAiProviderList(s);
  return uiMode === 'light' ? all.filter((p) => p.id === LOBEHUB_PROVIDER_ID) : all;
};

const enabledImageModelListByMode = (uiMode: UiMode) => (s: AIProviderStoreState) => {
  const all = s.enabledImageModelList || [];
  return uiMode === 'light' ? all.filter((m) => m.providerId === LOBEHUB_PROVIDER_ID) : all;
};

const enabledVideoModelListByMode = (uiMode: UiMode) => (s: AIProviderStoreState) => {
  const all = s.enabledVideoModelList || [];
  return uiMode === 'light' ? all.filter((m) => m.providerId === LOBEHUB_PROVIDER_ID) : all;
};
```

Export them in the selectors object at the bottom of the file:

```ts
export const aiProviderSelectors = {
  enabledAiProviderList,
  enabledAiProviderListByMode,
  enabledImageModelList,
  enabledImageModelListByMode,
  enabledVideoModelList,
  enabledVideoModelListByMode,
  // ...existing exports...
};
```

- [ ] **Step 2: Identify all consumers and route them through the new selector**

```bash
grep -rln "enabledAiProviderList\|aiProviderSelectors.enabledAiProviderList" src/ 2> /dev/null
```

For each consumer that renders the provider list in a UI surface (model picker dropdown, settings provider list), change the call site:

```tsx
// before
const list = useAiInfraStore(aiProviderSelectors.enabledAiProviderList);

// after
const uiMode = useUserStore(uiModeSelectors.current);
const list = useAiInfraStore(aiProviderSelectors.enabledAiProviderListByMode(uiMode));
```

Apply the same pattern to image and video model selectors (search `enabledImageModelList`, `enabledVideoModelList`).

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
npx pnpm build 2>&1 | tail -5
```

Expected: build succeeds.

- [ ] **Step 4: Quick sanity test**

After build + container restart (later task), in browser console as a logged-in user:

```js
// Force a snapshot
window.__store.getState().aiProviderList.map((p) => p.id);
```

Expected (in light): array length matches what the selector returned. We don't need a unit test for this — it's a thin filter.

- [ ] **Step 5: Commit**

```bash
git -c user.name=pasha -c user.email=2396741@gmail.com add \
  src/store/aiInfra/slices/aiProvider/selectors.ts \
  src/
git -c user.name=pasha -c user.email=2396741@gmail.com commit -m "feat(ai-infra): filter provider/image/video lists by ui_mode"
```

---

## Task 7: Sidebar + settings menu visibility by ui_mode

**Files:**

- Modify: `src/app/[variants]/(main)/home/_layout/Header/components/Nav.tsx`
- Modify: `src/app/[variants]/(main)/home/_layout/Body/BottomMenu/index.tsx`
- Modify: `src/features/MobileTabBar/index.tsx`
- Modify: `src/app/[variants]/(main)/settings/hooks/useCategory.tsx`

These four files were touched in Task 1.2 with `featureFlags.isSimpleUI`, then reverted in Task 3. Now we re-introduce gating, but driven by `uiMode === 'light'` from the store.

- [ ] **Step 1: Add the helper hook**

Create `src/features/UIMode/useIsLightMode.ts`:

```ts
'use client';

import { useUserStore } from '@/store/user';
import { uiModeSelectors } from '@/store/user/slices/uiMode/selectors';

export const useIsLightMode = () => useUserStore(uiModeSelectors.isLight);
```

Add to `src/features/UIMode/index.ts`:

```ts
export { useIsLightMode } from './useIsLightMode';
```

- [ ] **Step 2: Apply the hook in Nav.tsx**

Open `src/app/[variants]/(main)/home/_layout/Header/components/Nav.tsx`. At the top of the component:

```tsx
import { useIsLightMode } from '@/features/UIMode';

const Nav = memo(() => {
  const isLight = useIsLightMode();
  // ... existing items config ...
});
```

For each nav item that should disappear in Light, add `&& !isLight` to its visibility predicate. Items to hide in Light: Discover/Community, Pages, Image (we re-add it via the dedicated Image item below in step 4), Video (same), Files, Memory.

Add three items in Light mode that the spec calls for: Image, Video, and Pricing. Image and Video link to `/image` and `/video` (already existing routes). Pricing links to `/settings/subscription/plans`.

Sample structure (paste into the items array):

```tsx
{
  href: '/chat',
  hidden: false,
  icon: MessageSquare,
  key: 'chat',
  labelKey: 'tab.chat',
},
{
  href: '/image',
  hidden: !isLight,  // visible in Light only; in Pro the existing Image entry stays from upstream
  icon: ImageIcon,
  key: 'image',
  labelKey: 'tab.image',
},
{
  href: '/video',
  hidden: !isLight,
  icon: Video,
  key: 'video',
  labelKey: 'tab.video',
},
{
  href: '/settings/subscription/plans',
  hidden: !isLight,
  icon: Gem,
  key: 'pricing',
  labelKey: 'tab.pricing',
},
{
  href: '/discover',
  hidden: isLight,  // Discover hidden in Light
  // ...
},
// ... etc for Pages/Files/Memory ...
```

If the existing component computes items via a separate config file, change the gating logic in that config; else inline.

- [ ] **Step 3: Apply the hook in BottomMenu.tsx**

`src/app/[variants]/(main)/home/_layout/Body/BottomMenu/index.tsx`: hide Resource, Memory, etc. when `isLight`. Settings stays visible always.

- [ ] **Step 4: Apply the hook in MobileTabBar.tsx**

`src/features/MobileTabBar/index.tsx`: in light, show only Chat / Image / Video / Pricing / Settings tabs.

- [ ] **Step 5: Apply the hook in settings useCategory.tsx**

`src/app/[variants]/(main)/settings/hooks/useCategory.tsx`. The Light allowlist: `['profile', 'stats', 'common', 'chat-appearance', 'subscription', 'hotkey', 'about']`. Logic:

```tsx
import { useIsLightMode } from '@/features/UIMode';

const LIGHT_ALLOWLIST = new Set([
  'profile',
  'stats',
  'common',
  'chat-appearance',
  'subscription',
  'hotkey',
  'about',
]);

export const useCategory = () => {
  const isLight = useIsLightMode();
  // existing logic that builds `cateItems`...

  if (isLight) {
    return cateItems.filter((item) => LIGHT_ALLOWLIST.has(item.key));
  }
  return cateItems;
};
```

- [ ] **Step 6: Add i18n labels**

In `src/locales/default/onboarding.ts` and the two JSONs, add:

```ts
tab: {
  chat: 'Chat',
  image: 'Image',
  video: 'Video',
  pricing: 'Pricing',
},
```

Russian:

```json
"tab": {
  "chat": "Чат",
  "image": "Картинки",
  "video": "Видео",
  "pricing": "Тарифы"
}
```

If the existing i18n namespaces use `common` instead of `onboarding` for tab labels, place these keys there. Search `tab.chat` to confirm.

- [ ] **Step 7: Build + commit**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
npx pnpm build 2>&1 | tail -5
git -c user.name=pasha -c user.email=2396741@gmail.com add -A
git -c user.name=pasha -c user.email=2396741@gmail.com commit -m "feat(ui): sidebar + settings menu allowlist by ui_mode"
```

---

## Task 8: Provider settings page guard + custom-model addition hide

**Files:**

- Modify: `src/app/[variants]/(main)/settings/provider/_layout/Container.tsx` (or whichever file is the route's top-level layout — locate via `ls src/app/[variants]/(main)/settings/provider/`)

- Modify: any component that renders a "Add custom model" button — search step below

- [ ] **Step 1: Locate the provider page top component**

```bash
ls 'src/app/[variants]/(main)/settings/provider/' 2> /dev/null
```

Pick the page entry (usually `page.tsx` or `_layout/Container.tsx`).

- [ ] **Step 2: Redirect when light**

In the page component (server-component-friendly path is `page.tsx`):

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useIsLightMode } from '@/features/UIMode';

const ProviderSettingsPage = () => {
  const router = useRouter();
  const isLight = useIsLightMode();

  useEffect(() => {
    if (isLight) router.replace('/settings/profile');
  }, [isLight, router]);

  if (isLight) return null;

  // ...existing render...
};
```

- [ ] **Step 3: Find the "Add custom model" buttons**

```bash
grep -rln "showAddNewModel\|addCustomModel\|Add Model\|Добавить модель" src/ 2> /dev/null | head -10
```

For each button component, wrap with an `isLight` guard:

```tsx
const isLight = useIsLightMode();
if (isLight) return null;
return <Button>{t('addCustomModel')}</Button>;
```

- [ ] **Step 4: Build + commit**

```bash
npx pnpm build 2>&1 | tail -3
git -c user.name=pasha -c user.email=2396741@gmail.com add -A
git -c user.name=pasha -c user.email=2396741@gmail.com commit -m "feat(ui): hide provider settings + custom-model buttons in light mode"
```

---

## Task 9: Locked model UX — `<LockedModelTooltip />` + `<UpsellModal />`

**Files:**

- Create: `src/features/UIMode/LockedModelTooltip.tsx`

- Create: `src/features/UIMode/UpsellModal.tsx`

- Modify: `src/locales/default/onboarding.ts`, `src/locales/ru-RU/onboarding.json`, `src/locales/en-US/onboarding.json`

- Modify: the model picker rendering (search `aiProviderSelectors.enabledAiProviderListByMode` consumer locations)

- [ ] **Step 1: Add i18n for upsell modal**

In default `onboarding.ts`:

```ts
upsellModal: {
  title: 'Model «{{modelName}}» requires {{plan}} plan',
  body: '{{plan}} unlocks {{count}} models including premium options.',
  ctaUpgrade: 'Upgrade to {{plan}} — {{price}} ₽/mo',
  ctaClose: 'Close',
},
lockedModel: {
  tooltip: 'Available in {{plan}} plan',
},
```

Russian:

```json
"upsellModal": {
  "title": "Модель «{{modelName}}» доступна в плане {{plan}}",
  "body": "{{plan}} даёт доступ к {{count}} моделям включая премиум-варианты.",
  "ctaUpgrade": "Перейти на {{plan}} — {{price}} ₽/мес",
  "ctaClose": "Закрыть"
},
"lockedModel": {
  "tooltip": "Доступно в плане {{plan}}"
}
```

- [ ] **Step 2: Build the UpsellModal**

Create `src/features/UIMode/UpsellModal.tsx`:

```tsx
'use client';

import { Modal, Button, Flex, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  open: boolean;
  onClose: () => void;
  modelName: string;
  requiredPlan: string;
  planPriceRub: number;
}

const UpsellModal = memo<Props>(({ open, onClose, modelName, requiredPlan, planPriceRub }) => {
  const { t } = useTranslation('onboarding');
  const router = useRouter();

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      title={t('upsellModal.title', { modelName, plan: requiredPlan })}
      centered
      width={460}
    >
      <Typography.Paragraph>
        {t('upsellModal.body', { plan: requiredPlan, count: 12 })}
      </Typography.Paragraph>
      <Flex gap={8} justify="flex-end">
        <Button onClick={onClose}>{t('upsellModal.ctaClose')}</Button>
        <Button
          type="primary"
          onClick={() => {
            onClose();
            router.push('/settings/subscription/plans');
          }}
        >
          {t('upsellModal.ctaUpgrade', { plan: requiredPlan, price: planPriceRub })}
        </Button>
      </Flex>
    </Modal>
  );
});

UpsellModal.displayName = 'UpsellModal';

export default UpsellModal;
```

Add to `src/features/UIMode/index.ts`:

```ts
export { default as UpsellModal } from './UpsellModal';
export { default as LockedModelTooltip } from './LockedModelTooltip';
```

- [ ] **Step 3: Build the LockedModelTooltip wrapper**

Create `src/features/UIMode/LockedModelTooltip.tsx`:

```tsx
'use client';

import { Lock } from 'lucide-react';
import { memo, useState } from 'react';
import { Flexbox } from 'react-layout-kit';

import UpsellModal from './UpsellModal';

interface Props {
  children: React.ReactNode;
  modelName: string;
  requiredPlan: string;
  planPriceRub: number;
  isLocked: boolean;
}

const LockedModelTooltip = memo<Props>(
  ({ children, modelName, requiredPlan, planPriceRub, isLocked }) => {
    const [open, setOpen] = useState(false);

    if (!isLocked) return <>{children}</>;

    return (
      <>
        <Flexbox
          horizontal
          align="center"
          gap={6}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }}
          style={{ cursor: 'pointer', opacity: 0.6 }}
        >
          <Lock size={14} />
          {children}
        </Flexbox>
        <UpsellModal
          open={open}
          onClose={() => setOpen(false)}
          modelName={modelName}
          requiredPlan={requiredPlan}
          planPriceRub={planPriceRub}
        />
      </>
    );
  },
);

LockedModelTooltip.displayName = 'LockedModelTooltip';

export default LockedModelTooltip;
```

- [ ] **Step 4: Wire into the model picker**

The model picker that lists models inside a provider is in upstream LobeChat — search:

```bash
grep -rln "ModelSelect\|ModelOption\|ChatModelList" src/features 2> /dev/null | head -10
```

Pick the row component (typically `ModelSelect/Option.tsx` or `ChatModelList/Item.tsx`). Wrap each model row with the new component:

```tsx
import { LockedModelTooltip } from '@/features/UIMode';
import {
  isModelAllowedForPlanAsync,
  getRequiredPlanForModelAsync,
} from '@/server/modules/billing/model-tiers';

const ModelOption = ({ model, userPlan }) => {
  const [isLocked, setIsLocked] = useState(false);
  const [requiredPlan, setRequiredPlan] = useState('');
  const [planPrice, setPlanPrice] = useState(0);

  useEffect(() => {
    isModelAllowedForPlanAsync(model.id, userPlan).then((allowed) => setIsLocked(!allowed));
    getRequiredPlanForModelAsync(model.id).then((p) => {
      setRequiredPlan(p?.name ?? 'Pro');
      setPlanPrice(p?.priceRub ?? 1490);
    });
  }, [model.id, userPlan]);

  return (
    <LockedModelTooltip
      modelName={model.displayName ?? model.id}
      requiredPlan={requiredPlan}
      planPriceRub={planPrice}
      isLocked={isLocked}
    >
      <ModelRowContents model={model} disabled={isLocked} />
    </LockedModelTooltip>
  );
};
```

If `isModelAllowedForPlanAsync` is server-only, expose a thin client tRPC procedure (`billing.isAllowedForPlan`) and call that instead. Search `getRequiredPlanForModel` to see if it's already exposed via tRPC.

- [ ] **Step 5: Build + commit**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
npx pnpm build 2>&1 | tail -5
git -c user.name=pasha -c user.email=2396741@gmail.com add -A
git -c user.name=pasha -c user.email=2396741@gmail.com commit -m "feat(ui): locked-model tooltip + upsell modal"
```

---

## Task 10: Welcome modal copy update

**Files:**

- Modify: `src/features/Onboarding/WelcomeModal.tsx`

- Modify: `src/locales/default/onboarding.ts`

- Modify: `src/locales/ru-RU/onboarding.json`

- Modify: `src/locales/en-US/onboarding.json`

- [ ] **Step 1: Update copy strings**

In `src/locales/default/onboarding.ts`, update the `welcome.body` key:

```ts
welcome: {
  title: 'Welcome to WebGPT!',
  body: 'You have 20 free credits — enough for ~40 simple ChatGPT-style questions.\n\nYou are in **Light mode** — the simplest interface. Want to add your own API keys or unlock advanced settings? Switch to **Pro** in the top-right corner.',
  cta: 'Get started',
},
```

Russian:

```json
"welcome": {
  "title": "Добро пожаловать в WebGPT!",
  "body": "У вас 20 бесплатных кредитов. Этого хватит на ~40 простых вопросов к ChatGPT.\n\nВы в **Light режиме** — самом простом интерфейсе. Хотите подключить свои API-ключи или открыть продвинутые настройки — нажмите **Pro** в правом верхнем углу.",
  "cta": "Начать"
}
```

- [ ] **Step 2: Render markdown bold in body**

Open `src/features/Onboarding/WelcomeModal.tsx`. If body is rendered as plain text, swap to a markdown renderer (LobeChat already includes `markdown-it` or `react-markdown`):

```tsx
import ReactMarkdown from 'react-markdown';

<ReactMarkdown>{t('welcome.body')}</ReactMarkdown>;
```

If markdown is already supported, just confirm `**Light**` and `**Pro**` render bold.

- [ ] **Step 3: Build + commit**

```bash
git -c user.name=pasha -c user.email=2396741@gmail.com add \
  src/features/Onboarding/WelcomeModal.tsx \
  src/locales/
git -c user.name=pasha -c user.email=2396741@gmail.com commit -m "feat(onboarding): update welcome modal copy with Light/Pro toggle hint"
```

---

## Task 11: Push, deploy, smoke-test

**Files:** None to edit. This is the integration step.

- [ ] **Step 1: Push canary**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
git -c user.name=pasha -c user.email=2396741@gmail.com push origin canary
```

- [ ] **Step 2: Build the Docker image**

```bash
docker build -t lobechat-custom:latest /home/deploy/projects/ai-aggregator-lobechat 2>&1 | tail -3
```

Expected: build succeeds, image tagged.

- [ ] **Step 3: Restart aggregator**

```bash
cd /opt/lobechat && docker compose up -d --force-recreate lobe
sleep 10
curl -s https://ask.gptweb.ru/webapi/health
```

Expected: `{"db":"ok","status":"ok",...}`.

- [ ] **Step 4: Smoke-test as a NEW user**

Manual checklist (perform in browser):

1. Register a brand-new user (or `DELETE FROM user_onboarding WHERE user_id = '<your-id>'` to reset yourself).
2. Open `https://ask.gptweb.ru/`. Verify Welcome modal appears with new copy mentioning Light/Pro.
3. Click "Начать". Verify sidebar shows exactly: Чат / Картинки / Видео / Тарифы / Настройки.
4. In top-bar, find segmented control `[ ✨ Light │ ⚙️ Pro ]`. Verify it's Light.
5. Open the chat model selector. Verify only models from `lobehub` provider appear (no separate "Anthropic" or "OpenAI" provider headers).
6. Pick a locked model (e.g. Claude Opus on free plan). Verify 🔒 + UpsellModal opens with correct plan name + price.
7. Click "Pro" segment. Verify toast "Включён Pro режим..." + sidebar grows to full upstream nav (Discover/Pages/Memory/etc reappear).
8. Open model selector again. Verify other providers visible.
9. Click "Light" segment. Verify toast "Включён Light режим..." + sidebar shrinks back.
10. Reload. Verify Light mode persisted.
11. Open `/settings`. Verify only 8 items visible: Profile, Stats, Common, ChatAppearance, Subscription, Hotkey, About + Sign out.
12. Try to navigate to `/settings/provider`. Verify redirect to `/settings/profile`.
13. Send a chat message. Verify it works, balance decrements, no errors in container logs.

- [ ] **Step 5: Smoke-test as an EXISTING user**

Pick any existing user from `users` table. Verify their `user_onboarding.ui_mode` is `'light'`. Log in as them. Verify they see Light UI but no welcome modal (they've already seen it). Verify toggle still works.

- [ ] **Step 6: SQL verification**

```bash
docker exec lobe-postgres psql -U postgres -d lobechat -c "
SELECT ui_mode, count(*) FROM user_onboarding GROUP BY ui_mode;
"
```

Expected: all rows have `ui_mode='light'` initially. After your toggle test, you'll see at least one `'pro'` row.

- [ ] **Step 7: Container log review**

```bash
docker logs lobehub --since 10m 2>&1 | grep -iE 'error|failed|exception' | head -20
```

Expected: no relevant errors. (Some Upstash QStash warnings are pre-existing and OK.)

- [ ] **Step 8: Final commit if anything was tweaked during smoke-test**

```bash
git -c user.name=pasha -c user.email=2396741@gmail.com push origin canary
```

---

## Definition of Done

All 13 acceptance criteria from the spec satisfied:

| #   | Criterion                                           | Verified by                                      |
| --- | --------------------------------------------------- | ------------------------------------------------ |
| 1   | New user → `ui_mode='light'`                        | DB default (Task 1)                              |
| 2   | All existing rows backfilled to `light`             | Migration UPDATE (Task 1 step 1)                 |
| 3   | Light sidebar = 5 items                             | Task 7 + smoke-test step 3                       |
| 4   | Light chat selector = lobehub only                  | Task 6 + smoke-test step 5                       |
| 5   | Light Image/Video page = lobehub only               | Task 6 (image/video selectors)                   |
| 6   | Locked models → 🔒 + UpsellModal                    | Task 9 + smoke-test step 6                       |
| 7   | Toggle visible in top-bar                           | Task 5 + smoke-test step 4                       |
| 8   | Toggle Light → Pro instant, no reload               | Task 5 + smoke-test step 7                       |
| 9   | Toggle Pro → Light resets non-lobehub model + toast | Task 5 (handle in setUiMode action) + smoke-test |
| 10  | Settings in Light = 8 items                         | Task 7 + smoke-test step 11                      |
| 11  | NEXT_PUBLIC_SIMPLE_UI fully gone                    | Task 3 step 6 (`grep` returns 0)                 |
| 12  | Welcome modal mentions Pro toggle                   | Task 10 + smoke-test step 2                      |
| 13  | Build + deploy succeeds, /webapi/health 200         | Task 11 step 3                                   |

---

## Notes for the implementing engineer

- **Worktree:** clone-checkout `canary` is fine for everything except Task 3's git revert; that's done in the main checkout. If the revert would conflict with later commits, just do manual edits per Task 3 step 2.
- **`pnpm` not `npm`:** the merged upstream brought workspace deps. Always `npx pnpm@10.20.0` (or via corepack-enabled `pnpm`).
- **No global state mutation in handlers:** the toggle action does optimistic update + tRPC call + rollback on failure. Keep it that way.
- **One commit per Task minimum.** Multiple commits per Task is fine if it's natural (e.g. test commit then implementation commit). Co-Author line on every commit:
  ```
  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  ```
- **Don't break Pro mode.** Whatever LobeChat upstream did is what Pro looks like. Our gating is purely additive: when `isLight=true`, hide stuff. When `isLight=false`, render exactly upstream.
- **i18n fallback:** if a Russian string is missing, fallback to default (English). Don't crash.
- **Plan-name source:** `getRequiredPlanForModelAsync` lives in `src/server/modules/billing/model-tiers.ts`. If client can't import server code, expose a tRPC `billing.requiredPlanForModel(modelId)` proc that returns `{name, priceRub}`.
- **Onboarding modal Pro mode behavior:** if a user is in Pro mode AND has `firstLoginSeen=false`, still show the welcome modal (it's about onboarding, not mode). The copy mentions Pro toggle — for Pro users that copy is slightly off but harmless; if you want, branch the body string by `uiMode === 'light'`.
