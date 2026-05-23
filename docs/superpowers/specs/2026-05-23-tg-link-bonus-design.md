# Telegram-Link Bonus (+100 credits, 30-day expiry) — Design Spec

**Status:** Approved (2026-05-23)
**Owner:** WebGPT billing
**Related:** `docs/superpowers/specs/2026-05-22-payment-failure-recovery-design.md` (the channel this bonus feeds — more TG-linked users = better recovery reach)

## Problem

Only \~33% of paying-funnel users have a Telegram link. The other \~67% never get TG recovery DMs and stay below the surface for the bot-mediated parts of the product (chat-with-AI via DM, payment recovery, file uploads from chat). Today's UI doesn't actively prompt for the link — users have to discover it in settings.

The "link TG, get 100 credits, 30 days" promotion is a direct lever: turn a missing UX nudge into a measurable conversion event.

## Goal

For every user without a TG link, surface a one-time +100-credit offer in three places (onboarding step, PC sidebar card, mobile bottom-sticky CTA). On successful TG OAuth link, grant 100 bonus credits that expire 30 days later. After claiming once, the user never sees this offer again.

Success measure: **+10 percentage-point lift in TG-link rate** within 4 weeks (from \~33% → ≥43% among paying-funnel users), tracked via `userBilling.tgBonusClaimedAt IS NOT NULL` count over time.

## Non-Goals

- New auth providers, OAuth changes (TG OIDC already works)
- Reward stacking (one bonus per user, never re-grantable)
- Credit-display rework in the rest of the UI (the bonus pool surfaces as "100 кредитов истекают 23.06" only on hover/details — main balance display continues to show combined total)
- Onboarding redesign — we add ONE step into the existing flow, not a rewrite

## User Flow

### Path A — New user via onboarding

1. User registers (any provider — email, Google, Yandex, TG-OIDC).
2. Onboarding wizard runs. If the user landed via TG OIDC, the link already happened, the bonus was granted by the auth hook, the onboarding shows a **"+100 credits already added 🎁"** confirmation step (or skips it).
3. If the user landed via email/Google/Yandex, a dedicated step appears: **"Привяжи Telegram — получи 100 кредитов на 30 дней"** with a "Привязать через Telegram" button (triggers TG OIDC link flow) and a "Пропустить" link.
4. On successful link → toast `+100 кредитов на 30 дней` → onboarding continues.
5. On skip → onboarding continues, but the persistent banner takes over.

### Path B — Existing user (or new user who skipped)

1. User visits the app. `userBilling.tgBotChatId IS NULL && tgBonusClaimedAt IS NULL` → banner shows.
2. **PC layout:** card in the left sidebar, near settings/profile area. Compact: emoji + title + "Привязать" button.
3. **Mobile layout:** sticky 56px bar above `MobileTabBar`. One sentence + button. Cross-icon dismiss.
4. User clicks "Привязать" → opens TG OIDC link flow (modal or new tab — matches existing settings link UX).
5. On success → toast `+100 кредитов на 30 дней` → banner disappears reactively.
6. User clicks "X" dismiss → banner hidden for 7 days (localStorage `tg_link_banner_dismissed_until`). Re-appears after that, unless claimed in the meantime.

### Path C — Already-linked user

Banner never shows. `userBilling.tgBotChatId IS NOT NULL` → selector returns "hide".

### Path D — Re-link attempt (anti-fraud)

User unlinks TG, then links again. Server-side `linkTelegramAccount()` checks `tgBonusClaimedAt`. If non-null → grants 0 credits, returns `alreadyClaimed: true`. UI shows no toast, no banner appears.

## Data Model

Two changes to `userBilling`:

```ts
// packages/database/src/schemas/billing.ts
export const userBilling = pgTable('user_billing', {
  // ...existing fields...

  /** Separate balance for non-renewable bonus credits. Consumed first
   *  in the credit-spend cascade. Zeroed by the daily-bonus-expiry cron. */
  bonusBalance: integer('bonus_balance').notNull().default(0),

  /** When the current bonusBalance becomes worthless. Set by grant code,
   *  read by expiry cron. */
  bonusBalanceExpiresAt: timestamptz('bonus_balance_expires_at'),

  /** One-shot anti-fraud stamp. Set on first TG-link bonus grant, never
   *  cleared. Re-link attempts read this and skip the grant. */
  tgBonusClaimedAt: timestamptz('tg_bonus_claimed_at'),
});
```

We deliberately keep `tgBonusClaimedAt` separate from `bonusBalanceExpiresAt`:

- `tgBonusClaimedAt` is forever — anti-fraud ledger
- `bonusBalanceExpiresAt` is the expiry clock — can be null after expiry

If we later add other bonus types (referral, promo), they reuse `bonusBalance` + `bonusBalanceExpiresAt`. Each new bonus type gets its own `<type>BonusClaimedAt` ledger column. Trade-off is wide table over generic-bonus table; the codebase already follows this pattern for `expiryWarningSentAt`, `lowCreditsHintSentAt`, etc.

A migration:

```sql
ALTER TABLE user_billing
  ADD COLUMN bonus_balance integer NOT NULL DEFAULT 0,
  ADD COLUMN bonus_balance_expires_at timestamptz,
  ADD COLUMN tg_bonus_claimed_at timestamptz;
```

## Credit-Spend Order

Existing spend logic charges from `tokenBalance`. We change it to prefer `bonusBalance` first:

```ts
// pseudo-code at the charge call-site (writeUsageLog + decideChargeAfterStream)
const fromBonus = Math.min(amount, user.bonusBalance);
const fromMain = amount - fromBonus;
user.bonusBalance -= fromBonus;
user.tokenBalance -= fromMain;
```

Spend happens inside an existing DB transaction — no new locking concerns. The change is localized to the charge wrapper.

If `bonusBalance > 0` but `bonusBalanceExpiresAt < NOW()` (cron hasn't run yet), we still consume bonus first — it's logically fine. The expiry cron then finds nothing to zero.

## Expiry Cron

A new daily cron at `src/app/(backend)/api/cron/expire-bonus-balance/route.ts`:

```sql
UPDATE user_billing
SET bonus_balance = 0,
    bonus_balance_expires_at = NULL,
    updated_at = NOW()
WHERE bonus_balance > 0
  AND bonus_balance_expires_at IS NOT NULL
  AND bonus_balance_expires_at < NOW();
```

That's it. The query is idempotent; running it 12× per hour costs nothing. We schedule it daily at 03:00 MSK alongside the other billing maintenance crons.

Auth + telemetry: same Bearer pattern as `payment-recovery-notify`. Returns `{ ok: true, expired_count: N }`.

## Grant Logic

A new pure-ish module `src/server/modules/billing/grant-tg-link-bonus.ts`:

```ts
interface GrantResult {
  granted: number; // 0 or 100
  expiresAt?: string; // ISO timestamp if granted
  alreadyClaimed: boolean;
}

export async function grantTgLinkBonus(db: DrizzleClient, userId: string): Promise<GrantResult> {
  return db.transaction(async (tx) => {
    // 1. Lock the user_billing row
    const row = await tx
      .select({ tgBonusClaimedAt: userBilling.tgBonusClaimedAt })
      .from(userBilling)
      .where(eq(userBilling.userId, userId))
      .for('update')
      .limit(1);

    if (row[0]?.tgBonusClaimedAt) return { granted: 0, alreadyClaimed: true };

    // 2. UPSERT — handles freshly-registered users without a row
    const expiresAt = new Date(Date.now() + 30 * 86_400_000);
    await tx
      .insert(userBilling)
      .values({
        userId,
        bonusBalance: 100,
        bonusBalanceExpiresAt: expiresAt,
        tgBonusClaimedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userBilling.userId,
        set: {
          bonusBalance: sql`${userBilling.bonusBalance} + 100`,
          bonusBalanceExpiresAt: expiresAt,
          tgBonusClaimedAt: sql`NOW()`,
          updatedAt: new Date(),
        },
        // Belt-and-suspenders: the row-lock check above already prevents
        // re-grant; this WHERE clause double-locks at the DB level.
        setWhere: sql`${userBilling.tgBonusClaimedAt} IS NULL`,
      });

    return { granted: 100, expiresAt: expiresAt.toISOString(), alreadyClaimed: false };
  });
}
```

The function is idempotent under concurrent calls — the row lock + `setWhere` clause cover the gap.

## Trigger Points

Three places call `grantTgLinkBonus()`:

1. **Better Auth hook** — primary path. In `src/libs/better-auth/hooks/telegram-link.ts`, after the existing `userBilling` UPSERT that sets `tgBotChatId`, call `grantTgLinkBonus(serverDB, input.userId)`. Best-effort — failures log but don't block auth.

2. **tRPC `userBilling.claimTgLinkBonus` mutation** — recovery path. UI calls it after returning from TG OIDC with `?tg_linked=1`. Server checks `tgBotChatId IS NOT NULL && tgBonusClaimedAt IS NULL`. If true → calls grant. If false → no-op. Returns `{granted, expiresAt}`. Idempotent.

3. **Backfill script** (one-off, not committed) — for users who linked TG before this feature shipped. SQL: `UPDATE user_billing SET ... WHERE tgBotChatId IS NOT NULL AND tgBonusClaimedAt IS NULL`. Decision deferred — see "Backfill question" below.

We keep paths 1 and 2 both because the auth hook is "best-effort, never throws", but UX requires the user to actually see their balance update. The tRPC mutation re-runs the grant on the same data — idempotent, safe — and is what the toast hooks into.

## UI Components

### 1. Onboarding step — `src/features/Onboarding/steps/TelegramLinkStep.tsx` (new)

A single screen in the existing onboarding wizard. Skippable. Shows:

- Icon (Telegram blue)
- H2: «Привяжи Telegram — получи 100 кредитов»
- Subtitle: «Бесплатные 100 кредитов на 30 дней. Плюс — задавай вопросы боту прямо в Telegram.»
- Primary button: «Привязать через Telegram» (starts TG OIDC link)
- Link: «Пропустить»

Render condition: `!user.tgBotChatId && !user.tgBonusClaimedAt`. If already linked OR already claimed → skip step entirely.

### 2. Persistent banner — `src/features/TgLinkBonusBanner/` (new)

A small module that renders different layouts on PC vs mobile based on `useIsMobile()`. The render condition is identical to the onboarding step + `!localStorage.tg_link_banner_dismissed_until || Date.now() > stored`.

**PC layout (`PcSidebarCard.tsx`):**

- Card in left sidebar (use the same area as the future user-profile area — for now, placed at bottom of `Sidebar` content, above any footer)
- Compact: gradient background, emoji (🎁), title, button
- Height \~80px

**Mobile layout (`MobileStickyBar.tsx`):**

- Fixed positioning above `MobileTabBar` (so `bottom: TAB_BAR_HEIGHT`)
- Single-line: emoji + short text + button "Привязать"
- Cross-icon dismiss (right side)
- Height \~56px
- Slides up on mount, slides down on dismiss

### 3. Toast confirmation

When the user returns from TG OIDC with `?tg_linked=1` in the URL:

1. URL param triggers a one-time `useEffect` that calls `claimTgLinkBonus()` mutation.
2. If `{granted: 100}` → show `<Toast>🎁 +100 кредитов на 30 дней!</Toast>` for 5 s.
3. If `{alreadyClaimed: true}` → silent no-op (don't surprise the user with "you already got this").
4. URL param removed via `router.replace`.

This logic lives in `src/features/TgLinkBonusBanner/useClaimOnReturn.ts` — mounted once in the main layout.

## File Map

| File                                                               | Status    | Purpose                                                                            |
| ------------------------------------------------------------------ | --------- | ---------------------------------------------------------------------------------- |
| `packages/database/src/schemas/billing.ts`                         | modify    | Add `bonusBalance`, `bonusBalanceExpiresAt`, `tgBonusClaimedAt` to `userBilling`.  |
| `packages/database/src/migrations/XXXX_tg_bonus.sql`               | new       | ALTER TABLE adding the three columns.                                              |
| `src/server/modules/billing/grant-tg-link-bonus.ts`                | new       | Idempotent grant function.                                                         |
| `src/server/modules/billing/__tests__/grant-tg-link-bonus.test.ts` | new       | Tests: first call grants, second is no-op, concurrent calls safe.                  |
| `src/libs/better-auth/hooks/telegram-link.ts`                      | modify    | Call `grantTgLinkBonus()` after `tgBotChatId` upsert.                              |
| `src/server/modules/billing/charge-credits.ts` (or equivalent)     | modify    | Prefer `bonusBalance` before `tokenBalance` in the spend cascade.                  |
| `src/business/server/lambda-routers/userBilling.ts`                | modify    | Add `claimTgLinkBonus` mutation.                                                   |
| `src/app/(backend)/api/cron/expire-bonus-balance/route.ts`         | new       | Daily expiry cron. Returns `{ok, expired_count}`.                                  |
| `src/features/Onboarding/steps/TelegramLinkStep.tsx`               | new       | Onboarding step.                                                                   |
| `src/features/Onboarding/index.tsx` (or step list)                 | modify    | Register the new step in the onboarding flow.                                      |
| `src/features/TgLinkBonusBanner/index.tsx`                         | new       | Public entry — branches on mobile vs PC.                                           |
| `src/features/TgLinkBonusBanner/PcSidebarCard.tsx`                 | new       | PC layout.                                                                         |
| `src/features/TgLinkBonusBanner/MobileStickyBar.tsx`               | new       | Mobile layout.                                                                     |
| `src/features/TgLinkBonusBanner/useClaimOnReturn.ts`               | new       | URL-param-based claim-on-return hook.                                              |
| `src/features/TgLinkBonusBanner/useShouldShow.ts`                  | new       | Selector: `tgBotChatId IS NULL && tgBonusClaimedAt IS NULL && !dismissedRecently`. |
| `src/app/[variants]/(main)/_layout/index.tsx`                      | modify    | Mount `TgLinkBonusBanner` and `useClaimOnReturn`.                                  |
| `/etc/cron.d/lobechat-expire-bonus-balance`                        | new (ops) | Daily 03:00 MSK cron entry pointing at the new endpoint.                           |

Total: \~7 new files, 6 modified, 1 migration, 1 ops cron entry.

## Anti-Fraud Matrix

| Scenario                                          | Outcome                                                                                                  |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| User #1 registers → links TG #A first time        | ✅ +100 credits, `tgBonusClaimedAt` stamped                                                              |
| User #1 unlinks TG #A → links TG #B               | ❌ no bonus (`tgBonusClaimedAt` non-null)                                                                |
| User #1 unlinks TG #A → links TG #A again         | ❌ no bonus                                                                                              |
| Two users try to link TG #A simultaneously        | Better Auth `(provider, account_id)` UNIQUE — second fails. No exploit.                                  |
| User deletes account → re-registers → links TG #A | New `user_id`. Bonus granted. Accepted risk (account deletion is a real user action, not a gaming move). |
| Concurrent grant calls (race)                     | Row-lock + `setWhere` clause — second call sees `tgBonusClaimedAt IS NULL` is false, no-op.              |

## Backfill Question (deferred decision)

Users who linked TG before this feature shipped — do they get 100 credits retroactively?

- **Pro:** Goodwill, equal treatment.
- **Con:** \~50 existing TG-linked users × 100 = 5,000 credits granted to people who didn't act on the promo. Negligible cost.

**Default decision:** YES, backfill — flat-fair. Run ONCE on launch day. Script:

```sql
UPDATE user_billing
SET tg_bonus_claimed_at = NOW(),
    bonus_balance = bonus_balance + 100,
    bonus_balance_expires_at = NOW() + INTERVAL '30 days'
WHERE tg_bot_chat_id IS NOT NULL
  AND tg_bonus_claimed_at IS NULL;
```

Backfill happens AFTER the migration but BEFORE the persistent banner is enabled in the UI — so backfilled users never see the offer (their `tgBonusClaimedAt` is already set).

## Observability

- Metric: `SELECT COUNT(*) FROM user_billing WHERE tg_bonus_claimed_at > NOW() - INTERVAL '24 hours'` — daily claim count.
- Metric: lift in TG-linked share: `SELECT COUNT(*) FILTER (WHERE tg_bot_chat_id IS NOT NULL) * 100.0 / COUNT(*) FROM user_billing` — weekly snapshot.
- Optional new admin page or block — defer to a follow-up unless trivial to add to `/finance/payment-failures`.

## Testing Strategy

1. **Unit:** `grant-tg-link-bonus.test.ts` — first call grants, second call no-ops, concurrent calls don't double-grant (use vitest concurrent + mocked transaction).
2. **Unit:** `useShouldShow.test.ts` — selector returns correct boolean for every combination of `tgBotChatId × tgBonusClaimedAt × dismissedUntil`.
3. **Integration:** TG link flow → check DB has `bonusBalance=100, tgBonusClaimedAt set, expiresAt = NOW+30d` exactly.
4. **Integration:** Expiry cron — pre-stamp `bonusBalanceExpiresAt = NOW()-1m, bonusBalance=100` → run cron → assert balance=0.
5. **Manual UI smoke:** test on PC (card visible/hides correctly) and on mobile viewport (sticky bar above tab bar, dismiss persists 7 days).
6. **Anti-fraud smoke:** unlink TG → re-link → confirm no second toast, balance unchanged.

## Rollout

1. Land schema migration on `canary`.
2. Land grant module + hook integration + spend-order change + cron + tRPC mutation. Deploy.
3. Run backfill SQL on production DB.
4. Land UI components (onboarding step + banner + claim-on-return). Deploy.
5. Add cron entry to host crontab.
6. Smoke: log into a fresh test account → register → see onboarding step → link TG → toast appears → balance shows 100 bonus.
7. Day-7: dashboard check — claim count, dismiss rate, any errors in the expiry cron.
8. Day-30: validate first expiry tick — does `bonusBalance` zero out cleanly for the first cohort.

## Risks

- **Spend-order regression** — changing the credit-charge cascade is the highest-risk change. Mitigation: comprehensive test coverage on the charge path before deploy, dry-run on staging.
- **Backfill mistake** — accidentally setting `tgBonusClaimedAt` on users who already had it set would zero-out their bonus. The SQL above uses `WHERE tg_bonus_claimed_at IS NULL` — safe.
- **UI banner overload** — too many banners can hurt UX. Mitigation: 7-day dismiss cookie, auto-hide-on-claim, single banner instance globally.
- **Mobile bottom-sticky overlap** with browser chrome (Safari address bar) — confirm `safe-area-inset-bottom` padding on the sticky bar.
