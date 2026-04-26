# Referral + Cashout — Design Spec

**Date:** 2026-04-26
**Status:** Approved (user signed off on cashout rate + manual processing)
**Sprint:** Phase 2.1 (UX growth plan)

## Goal

Two-tier referral program with Notion-style credit rewards + opt-in manual cashout for users who prefer cash over in-product credits.

## Economics

- **In-product credit value:** 1 credit = **0.15 ₽**
- **Cashout rate:** 1 credit = **0.05 ₽** (3× worse than in-product → encourages staying in product, anti-abuse, NOT a currency replacement)
- **Min cashout:** 5000 credits = 250 ₽ (cuts dust + admin overhead)

## Bonus structure

| Recipient     | Trigger                                                  | Reward          | Real cost (markup=3) |
| ------------- | -------------------------------------------------------- | --------------- | -------------------- |
| Referred user | Signup with `?ref=<code>`                                | **+20 credits** | \~1 ₽                |
| L1 referrer   | Referred user makes first **succeeded** billing payment  | **+50 credits** | \~2.5 ₽              |
| L2 referrer   | Sub-referred (grand-child) makes first succeeded payment | **+25 credits** | \~1.25 ₽             |

CAC budget per acquired paying user: \~5 ₽ (0.3% of 1490 ₽ Pro revenue). Very conservative; can scale up if conversion rate justifies.

## Data model

### `users` table additions

```sql
ALTER TABLE users ADD COLUMN referral_code varchar(8) UNIQUE;
ALTER TABLE users ADD COLUMN referred_by_l1 text REFERENCES users(id);
ALTER TABLE users ADD COLUMN referred_by_l2 text REFERENCES users(id);
CREATE INDEX users_referred_by_l1_idx ON users(referred_by_l1);
CREATE INDEX users_referred_by_l2_idx ON users(referred_by_l2);
```

`referred_by_l1` = direct referrer; `referred_by_l2` = referrer's referrer (denormalized for fast L2-credit hook). Both NULL by default for organic signups.

### `referrals` table (new)

```sql
CREATE TABLE referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level smallint NOT NULL CHECK (level IN (1, 2)),
  status text NOT NULL CHECK (status IN ('pending', 'rewarded', 'rejected_abuse', 'rejected_no_payment')) DEFAULT 'pending',
  credits_awarded int DEFAULT 0,
  rejection_reason text,
  created_at timestamptz DEFAULT now() NOT NULL,
  rewarded_at timestamptz NULL,
  UNIQUE (referrer_user_id, referred_user_id, level)
);
CREATE INDEX referrals_status_idx ON referrals(status);
CREATE INDEX referrals_referrer_idx ON referrals(referrer_user_id);
```

Each successful signup creates **two** rows: one L1 (immediate referrer) and one L2 (grand-parent, if exists). Both start as `pending`. On first payment of `referred_user_id`, both rows flip to `rewarded` with respective credit amounts (50 / 25).

### `cashout_requests` table (new)

```sql
CREATE TABLE cashout_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credits_requested int NOT NULL CHECK (credits_requested >= 5000),
  rate_rub_per_credit numeric(8, 4) NOT NULL DEFAULT 0.05,
  amount_rub int NOT NULL,  -- denormalized: credits × rate
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'paid', 'rejected')) DEFAULT 'pending',
  payment_method text,  -- free text: "Сбер 1234", "СБП 79991234567", etc.
  payment_details text,  -- bank card number, phone for СБП, etc.
  admin_notes text,
  created_at timestamptz DEFAULT now() NOT NULL,
  processed_at timestamptz NULL,
  processed_by text NULL  -- admin email who approved
);
CREATE INDEX cashout_requests_status_idx ON cashout_requests(status);
CREATE INDEX cashout_requests_user_idx ON cashout_requests(user_id);
```

When user submits cashout request:

1. Validate `credits_requested ≥ 5000` and ≤ user's available balance
2. Atomically deduct credits from `user_billing.token_balance` (or revert on transaction failure)
3. Insert row with `status='pending'`
4. Admin sees in `/admin/cashouts` queue → manually pays via YooKassa Личный кабинет → marks `status='paid'` with payment details

## Backend hooks

### Landing middleware

Read `?ref=<code>` from query string on `/` (and `/chat`, `/signup`). If present, validate `code` exists in `users.referral_code`. If valid, set cookie `_ref=<code>` for 30 days, then 302-redirect to clean URL (no `?ref=`). If invalid (no such code), drop the param silently.

File: `src/middleware.ts` (likely existing in lobechat fork).

### Better Auth signup callback

When a new user is created (Better Auth post-signup hook OR a custom procedure called from signup flow):

1. Read cookie `_ref=<code>`
2. Find `referrer_user = users WHERE referral_code = code`. If absent, abort referral (organic signup).
3. **Anti-abuse checks** (any failure → skip referral):
   - `referrer_user.id !== new_user.id` (no self-refer)
   - Email domain not in disposable list (basic regex check)
   - No existing user with same `email` (via Better Auth uniqueness — already enforced)
   - Optional: IP velocity check — if ≥3 signups from same IP in 24h with same `_ref`, mark suspicious (not blocking, just flag)
4. If checks pass:
   - `users.referred_by_l1 = referrer_user.id`
   - `users.referred_by_l2 = referrer_user.referred_by_l1` (NULL if referrer is organic)
   - Create `referrals` rows: L1 and (if L2 exists) L2
   - Add 20 credits to `user_billing.token_balance` of the new user
5. Generate `referral_code` for the new user (8 chars `[a-z0-9]`, retry on collision).

### `fulfill.ts` extension

In `src/server/modules/billing/fulfill.ts` after a successful subscription payment:

```ts
async function rewardReferralChain(db, paidUser) {
  // Find L1 + L2 pending referrals for this user
  const pendingRefs = await db
    .select()
    .from(referrals)
    .where(and(eq(referrals.referredUserId, paidUser.id), eq(referrals.status, 'pending')));

  for (const ref of pendingRefs) {
    const reward = ref.level === 1 ? 50 : 25;
    await db.transaction(async (tx) => {
      await tx
        .update(userBilling)
        .set({ tokenBalance: sql`${userBilling.tokenBalance} + ${reward}` })
        .where(eq(userBilling.userId, ref.referrerUserId));
      await tx
        .update(referrals)
        .set({ status: 'rewarded', creditsAwarded: reward, rewardedAt: new Date() })
        .where(eq(referrals.id, ref.id));
    });
  }
}
```

Called only on **first** payment of paid user (track via `users.first_paid_at` flag or check `count(billing_payments)`).

## tRPC procedures

New router `src/business/server/lambda-routers/referrals.ts`:

- `getMyReferralState()` → `{ code, totalReferred, totalRewarded, totalCreditsEarned }`
- `getMyReferralList()` → paginated list of `{ referredEmail (masked), level, status, creditsAwarded, createdAt }`
- (mutation) `requestCashout({ creditsRequested, paymentMethod, paymentDetails })` → creates `cashout_requests` row + deducts credits

New router `src/business/server/lambda-routers/cashout.ts`:

- `listMyCashouts()` → user's history
- `requestCashout({ ... })` → already above, alias

## UI

### `/settings/referrals` (user-facing)

Visible in **both Light and Pro mode**.

Layout:

```
┌─────────────────────────────────────────────┐
│ 🎁 Пригласите друзей и получайте бонусы     │
├─────────────────────────────────────────────┤
│ Ваша ссылка:                                 │
│ [ https://ask.gptweb.ru/?ref=abc12def ] 📋  │
│ [ Поделиться: Telegram | WhatsApp | X ]      │
├─────────────────────────────────────────────┤
│ Бонусы:                                      │
│ • +20 кредитов другу при регистрации         │
│ • +50 кредитов вам, когда друг купит подписку│
│ • +25 кредитов вам с друга вашего друга      │
├─────────────────────────────────────────────┤
│ Заработано: 175 кредитов                     │
│ Ожидают платежа: 3 приглашённых              │
│                                              │
│ [Таблица: имя/статус/уровень/кредиты]        │
├─────────────────────────────────────────────┤
│ 💸 Вывести кредиты                           │
│ Курс: 1 кредит = 0.05 ₽                      │
│ Минимум: 5000 кредитов (= 250 ₽)             │
│ [ Запросить вывод ]                          │
└─────────────────────────────────────────────┘
```

### Sidebar item in Light

`🎁 Пригласить` between `Тарифы` and `Настройки`. Same icon (`Gift` from lucide-react). Visible in both Light and Pro.

### `/admin/referrals` (admin)

Table view with filters by status. Columns:

- Referrer email
- Referred email
- Level (1 / 2)
- Status (pending / rewarded / rejected_abuse / rejected_no_payment)
- Credits awarded
- Created at / Rewarded at
- Actions (override status, manually mark abuse)

### `/admin/cashouts` (admin)

Cashout approval queue. Columns:

- User email
- Credits requested
- Amount RUB
- Payment method + details
- Status
- Actions: **Approve** (move to `approved` for processing), **Mark Paid** (set `status='paid'`, log who/when), **Reject** (refund credits to user)

Refund logic on reject: `UPDATE user_billing SET token_balance = token_balance + credits_requested WHERE user_id = X` + `UPDATE cashout_requests SET status='rejected'`.

## Anti-abuse defenses (summary)

1. **No self-refer:** `referrer_id !== referred_id` enforced at signup time.
2. **Email uniqueness:** already enforced by Better Auth.
3. **Disposable email regex:** basic `/(@(mailinator|tempmail|guerrillamail|10minutemail|throwaway)\.)/i` check; fail → skip referral but allow signup.
4. **IP velocity (passive):** if ≥3 signups from same IP in 24h with same `_ref` cookie, flag in admin (not auto-block).
5. **Cashout floor:** 5000 credits minimum prevents farming small bonuses.
6. **Rate gap:** in-product 0.15 ₽ vs cashout 0.05 ₽ means cashout is 3× worse than using credits. Not attractive for fraud.
7. **Manual approval:** all cashouts go through admin queue; suspicious patterns (new account, just barely 5000 cr from referrals only, no own usage) can be rejected.

## Out of scope (YAGNI)

- L3+ referrals (only 2 levels)
- Custom welcome page per referral code
- A/B testing reward amounts (Phase 3+)
- Cashout via YooKassa Payouts API integration (Phase 3+ when volume justifies)
- Referral leaderboards / gamification
- Email notifications to referrer when their referred user signs up (just on payment reward)

## Acceptance criteria

| #   | Criterion                                                                      |
| --- | ------------------------------------------------------------------------------ |
| 1   | `users.referral_code` populated for all users (8 chars, unique)                |
| 2   | Visiting `?ref=<valid_code>` then signing up sets `users.referred_by_l1`       |
| 3   | Self-refer attempt (same email/IP) → no referral row created                   |
| 4   | Disposable email referral → no referral row, organic signup                    |
| 5   | Welcome bonus +20 credits applied on signup with valid `?ref=`                 |
| 6   | First successful payment by referred user awards L1 referrer +50               |
| 7   | If L2 exists, same payment also awards L2 referrer +25                         |
| 8   | Subsequent payments (2nd, 3rd, ...) do NOT trigger additional referral rewards |
| 9   | `/settings/referrals` shows: code, list, earned, cashout button                |
| 10  | Cashout request with < 5000 credits → rejected with error                      |
| 11  | Cashout request ≥ 5000 deducts from balance + creates `cashout_requests` row   |
| 12  | Admin can approve/reject cashout; rejection refunds credits                    |
| 13  | Sidebar Light shows "Пригласить" item between Тарифы and Настройки             |
