# Referral System V1 — Design Spec

**Status:** Approved (2026-05-24)
**Owner:** WebGPT growth
**Related:** `docs/superpowers/specs/2026-05-23-tg-link-bonus-design.md` (this feature reuses the bonusBalance pool + TG-link hook the bonus feature introduced)

## Problem

Free-tier users have 35 credits/month. When that runs out, the only path forward we surface today is "buy a subscription". Most won't — they bounce. We have a 2-level referral system already coded (DB schema, tRPC router, UI page) but never activated: 0 rows in `referrals`, 0 in `cashout_requests`, every user's `referred_by_l1` is NULL despite 1496 users having a `referral_code` assigned.

Activating that system gives bounced free users a second option ("invite a friend → +100 credits") AND turns existing users into a viral acquisition channel — both at near-zero marginal cost since most referral usage will route through the local Gemma model (no API spend on our side).

## Goal

For every free user who hits their credit ceiling, surface a referral CTA that grants both the referrer and referee +100 bonus credits (30-day expiry) when the referee links Telegram. If the referee then refers someone themselves, the original referrer earns +30 from that level-2 connection.

Anti-fraud relies on two natural barriers: unique email (enforced by Better Auth) and unique Telegram phone (enforced by Telegram's signup process). Both barriers raise fraud cost above the credit reward value.

Success measure: **≥3 successful referrals/week** within 4 weeks of launch, tracked via `SELECT COUNT(*) FROM referrals WHERE status='rewarded' AND rewarded_at > NOW() - 7d`.

## Non-Goals

- Daily login bonuses, streaks, missions, content tasks — deferred
- Cashout (credits → real money) — code exists, stays dormant
- Bot integration (referrer notifications via Telegram) — defer to V2
- IP-based anti-fraud — TG-link gate is sufficient for V1
- Re-grant on Telegram re-link — one-shot per referral pair

## User Flow

### Path A — Referrer shares link

1. User opens `/settings/referral` (settings page already exists, currently inert).
2. Sees their share URL: `https://ask.gptweb.ru/?ref={referral_code}` with copy button.
3. Quick-share buttons (Telegram, VK, WhatsApp) pre-fill suggested text.

### Path B — Referee clicks link

1. Browser hits `/?ref=CODE` (cold or while logged out).
2. Next.js middleware reads the `ref` query param, sets cookie `ref_code=CODE` (httpOnly, secure, sameSite=lax, 30-day TTL), then `router.replace` strips the param so it doesn't pollute history.
3. User browses the landing, signs up via email / Google / Yandex / Telegram.
4. Better Auth `databaseHooks.user.create.after` fires. Hook reads the `ref_code` cookie, resolves it to a `referrer_user_id` via `users.referral_code`. Validates:
   - referrer exists,
   - `referrer_user_id !== new_user_id` (self-invite block).
5. Writes `users.referred_by_l1 = referrer_user_id`. If the referrer has their own `referred_by_l1 = X`, also writes `users.referred_by_l2 = X`.
6. Inserts 1–2 rows into `referrals`:
   - L1: `(referrer_user_id, new_user_id, level=1, status='pending', credits_awarded=0)`
   - L2 (if applicable): `(X, new_user_id, level=2, status='pending', credits_awarded=0)`
7. Cookie cleared.

### Path C — Referee triggers reward (links Telegram)

1. Referee uses the app, eventually links Telegram (via banner / settings).
2. Existing `linkTelegramAccount()` hook fires — already grants the +100 TG-link bonus and stamps `tg_bot_chat_id`. We add ONE call: `processReferralRewards(serverDB, userId)`.
3. `processReferralRewards` opens a transaction:
   - `SELECT … FROM referrals WHERE referred_user_id = userId AND status='pending' FOR UPDATE`.
   - For each pending row:
     - L1 (level=1): award the referrer 100 credits + award the referee (self) 100 credits.
     - L2 (level=2): award the L2 referrer 30 credits. Referee gets nothing extra at L2.
   - Update `referrals.status='rewarded', credits_awarded=N, rewarded_at=NOW()`.
   - Each award goes into `userBilling.bonusBalance += N`, `bonusBalanceExpiresAt = MAX(existing, NOW() + 30d)`.
4. Best-effort: hook continues even if this throws.

### Path D — Re-link or repeat

`referrals.status` is the idempotency key. After 'rewarded', repeat calls to `processReferralRewards` find no matching rows and no-op.

### Path E — Free user out of credits

1. `tokensUsedMonth >= tokenLimit` → existing `CreditsExhaustedModal` opens.
2. Modal now shows TWO CTAs side by side: **«Пригласить друга → +100 кр»** (→ `/settings/referral`) and **«Купить тариф»** (→ `/settings/plans`).

## Data Model

Reuses existing schema — no new migrations strictly required:

```ts
// users — already has these
referral_code: text UNIQUE
referred_by_l1: text  // FK users.id
referred_by_l2: text  // FK users.id

// referrals — already exists
referrer_user_id: text
referred_user_id: text
level: smallint  // 1 or 2
status: text     // 'pending' | 'rewarded' | 'rejected'
credits_awarded: integer
rejection_reason: text
created_at: timestamptz
rewarded_at: timestamptz

// user_billing — bonus pool reused from TG-link feature
bonus_balance: integer
bonus_balance_expires_at: timestamptz
```

**Backfill (one-off SQL):** ensure every `users` row has a non-null `referral_code`. The column is UNIQUE, so generate 8-char base32 codes for any NULL rows:

```sql
UPDATE users
SET referral_code = upper(substr(md5(id || 'salt-2026-05-24'), 1, 8))
WHERE referral_code IS NULL;
```

Run once at deploy time.

## Architecture

```
visit /?ref=ABCD1234
       │
       ▼
middleware.ts  ── sets cookie ref_code=ABCD1234, strips ?ref= ──▶ landing page
       │
       ▼
user signs up via Better Auth (any provider)
       │
       ▼
databaseHooks.user.create.after
   │ read cookie, resolve code → referrer_user_id
   │ write users.referred_by_l1 + l2
   │ insert referrals rows (pending)
   │
   ▼
... time passes ...
       │
       ▼
user links Telegram → linkTelegramAccount hook
   │ existing: stamp tg_bot_chat_id, grantTgLinkBonus (+100)
   │ NEW: processReferralRewards
   │      ├── find pending referrals for this user
   │      ├── award L1 referrer + self (+100 each) — atomic
   │      ├── award L2 referrer (+30) if exists
   │      └── flip status to 'rewarded'
   │
   ▼
referrer sees +100 in their balance, banner stops showing if they were in CreditsExhaustedModal
```

## File Map

| File                                                                     | Status                       | Responsibility                                                                                                                                                                                      |
| ------------------------------------------------------------------------ | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/middleware.ts`                                                      | modify (or create if absent) | Capture `?ref=CODE`, set cookie, strip param via `NextResponse.rewrite`/`redirect`.                                                                                                                 |
| `src/server/modules/referral/capture-ref-cookie.ts`                      | new                          | Server-side helper. `resolveRefCookie(headers) → Promise<{referrerUserId, code} \| null>`. Reads cookie, validates code against `users.referral_code`, returns null on self-invite or invalid code. |
| `src/server/modules/referral/process-referral-rewards.ts`                | new                          | `processReferralRewards(db, refereeUserId) → Promise<{awardedCount, totalCredits}>`. Idempotent. Transactional.                                                                                     |
| `src/server/modules/referral/__tests__/process-referral-rewards.test.ts` | new                          | 4 tests with real lobe-postgres: L1 only / L1+L2 / already rewarded / no pending.                                                                                                                   |
| `src/libs/better-auth/define-config.ts`                                  | modify                       | `databaseHooks.user.create.after` — call `resolveRefCookie` + `recordPendingReferrals`.                                                                                                             |
| `src/server/modules/referral/record-pending.ts`                          | new                          | `recordPendingReferrals(db, refereeUserId, referrerUserId)` — writes `users.referred_by_l1/l2` + inserts `referrals` rows.                                                                          |
| `src/libs/better-auth/hooks/telegram-link.ts`                            | modify                       | After the existing `grantTgLinkBonus` call, add `processReferralRewards(serverDB, input.userId)` inside try/catch.                                                                                  |
| `src/business/client/BusinessSettingPages/Referral.tsx`                  | modify                       | Surface referral URL + copy/share + reorder existing stats. Hide CashoutModal (delete import).                                                                                                      |
| `src/components/CreditsExhaustedModal/CreditsExhaustedModal.tsx`         | modify                       | Add «Пригласить друга → +100 кр» CTA next to upgrade button.                                                                                                                                        |
| `packages/database/migrations/NNNN_referrals_unique.sql`                 | new                          | Partial unique index `referrals(referred_user_id, level) WHERE status != 'rejected'` to prevent two referrers claiming the same referee.                                                            |

Total: \~5 new files + 1 migration (\~250 LOC including tests), 4 modified files.

## Anti-Fraud

Single line of defense: **referee must link Telegram** for any award to fire. TG signup requires:

- A unique mobile phone number (per Telegram).
- A unique email at our end (per Better Auth).

To fake one successful referral the attacker needs a new email AND a new SIM. To farm 100 fakes they need 100 SIMs. Reward per fake = 130 credits ≈ 6.5₽ cashout-equivalent (cashout is disabled but conservative valuation). Cost of one SIM: 100₽+. Economics are negative for the attacker.

**Edge cases:**

- Self-invite: blocked at the resolve step (`referrer_user_id === new_user_id` → reject).
- Referee already linked TG before referrer captured: `linkTelegramAccount` hook calls `processReferralRewards`, finds no pending rows (none written yet — signup happened before the cookie cleanup). No-op. Correct.
- Cookie expires between visit and signup: referral lost. Acceptable — user can re-share.
- Two referrers both claim the same referee (race): `referrals` has no UNIQUE constraint on `(referred_user_id, level)`. We add one in the migration: `UNIQUE(referred_user_id, level) WHERE status != 'rejected'`. Second insert fails → first wins.

## Observability

- New SQL query in webgpt-admin `/finance` or a small standalone page:
  ```sql
  SELECT COUNT(*) FILTER (WHERE status='rewarded') AS rewarded,
         COUNT(*) FILTER (WHERE status='pending') AS pending,
         SUM(credits_awarded) FILTER (WHERE level=1) AS l1_credits_total,
         SUM(credits_awarded) FILTER (WHERE level=2) AS l2_credits_total
  FROM referrals
  WHERE created_at > NOW() - INTERVAL '30 days';
  ```
- Daily snapshot: count of new pending referrals per day. If a day shows abnormally high count, alert (potential fraud wave).

## Testing Strategy

1. **Unit:** `process-referral-rewards.test.ts` against real lobe-postgres (mirrors `grant-tg-link-bonus.test.ts` skip-if-no-env pattern):
   - L1-only referral → both sides +100, status='rewarded'.
   - L1 + L2 referral → L1 sides +100, L2 referrer +30, both status='rewarded'.
   - Calling twice on the same user → second call no-op (status check).
   - User with no pending referrals → no-op, no DB writes.
2. **Manual signup smoke** (T9-style):
   - Open `/?ref=<test_code>` in incognito → cookie set.
   - Sign up new email user → DB has `referrals` row pending.
   - Link Telegram → row flips rewarded, bonus_balance on both ends +100.
3. **Self-invite test:** open `/?ref=<your_own_code>` and sign up → no `referrals` row created.

## Rollout

1. Land code on canary.
2. Apply backfill SQL (any NULL `referral_code` rows).
3. Add UNIQUE constraint on `referrals(referred_user_id, level)` via migration.
4. Deploy (\~10 min).
5. Smoke: create test referee under a known referrer, verify reward flow end-to-end on prod.
6. Land UI changes (referral page + CreditsExhaustedModal CTA).
7. Re-deploy.
8. Day-7 metrics check.

## Risks

- **Cookie loss on iOS private mode** — referral lost silently. Acceptable; users will re-share.
- **L2 race**: if A → B → C signs up nearly simultaneously, B might not yet have `referred_by_l1=A` when C's hook runs. Mitigation: the L1/L2 inserts happen atomically inside C's signup hook, reading B's current state. If B has no `referred_by_l1` yet (race), C only gets an L1 row. Acceptable — race is rare and only costs us a missed L2 (30 credits).
- **Credit pool runaway**: 1000 successful L1 referrals = 200k credits granted = \~30000₽ at cashout-equivalent. Even if all activated on cloud models, server cost = \~30000₽. Most will route to free Gemma → effectively zero. Worst-case manageable; monitor.
- **Reward-trigger drift**: if `linkTelegramAccount` hook silently fails (e.g. bot down), `processReferralRewards` doesn't fire. Mitigation: separate retry cron at week-1 if needed; defer until we see actual failures.
