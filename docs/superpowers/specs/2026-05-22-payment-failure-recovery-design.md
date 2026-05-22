# Payment Failure Recovery — Design

**Date:** 2026-05-22
**Project:** ask.gptweb.ru (`ai-aggregator-lobechat`)
**Scope:** Problem C from registration→payment funnel analysis. Telemetry for YooKassa failure reasons + multi-channel recovery to convert failed/canceled attempts.

**Update 2026-05-22 (post-spec):** Pavel linked YooKassa to the Telegram bot via BotFather, giving us a Telegram Payments `provider_token` stored as `TELEGRAM_PAYMENT_PROVIDER_TOKEN` in `/opt/lobechat/.env` and the bot's env. The bot can now request payments natively inside the chat via `bot.api.sendInvoice` — no browser, no new tab, single-tap UX. The recovery DM (Change #4b below) uses **invoice as the primary method**, with URL buttons as fallback. A new endpoint `POST /api/billing/telegram-payment-fulfill` bridges Telegram `successful_payment` events back to our `billing_payments` table.

---

## Problem statement

30-day funnel measured against production DB:

```
1,239 registrations
    ↓ 76% never use the product
  299 used credits at least once
    ↓ 93% of active users never try to pay
   20 attempted payment
    ↓ 60% of payment attempts fail
    8 paid users
```

Problem C (this spec): of 20 users who got out their card and clicked "pay", only 8 succeeded. **12 high-intent users walked away** in 30 days. Their failures decompose into:

- **19 canceled**, all auto-canceled by reconcile-cron exactly \~62 minutes after creation → user landed on YooKassa hosted page, did not complete payment, left.
- **19 failed**, 7 of which come from a single user retrying 7 times within 6 minutes with different amounts → card-decline cascade.

We currently capture **no failure reason** — `cancellation_details` and `payment_method` from YooKassa webhook payloads are discarded by both `webhook/route.ts` and the reconcile cron. We are flying blind.

## Success criteria

Target measured 4 weeks after deploy, vs 30-day baseline before deploy:

| Metric                                 | Baseline | Target      |
| -------------------------------------- | -------- | ----------- |
| Paid users / week                      | 1.87     | **≥7** (+5) |
| Succeeded payments / month             | 9        | ≥30         |
| Payment fail rate                      | 60%      | ≤35%        |
| Recovery rate (failed→retry→succeeded) | 0%       | ≥15%        |

If +5/week is not reached, next iteration is embedded YooKassa widget (separate spec, out of scope here).

---

## Architecture

5 change-points in `ai-aggregator-lobechat` + 1 endpoint in `gptwebrubot` (Telegram bot) + 1 cron + 1 new page in `webgpt-admin`.

```
User clicks "Купить 490₽" on /settings/plans
        │
        ▼
topUp.purchase or subscription.start tRPC mutation
   ├─ NEW: createYookassaPayment(..., paymentMethodType: 'sbp')   [change #1]
   └─ NEW: billing_payments.metadata = { sbp_preselected:true,
                                          tg_user_id: <chatId>,
                                          pricing_variant }       [change #2]
        │
        ▼
redirect → yookassa.ru   ──pay─→ webhook payment.succeeded
                          │
                          └─not pay→ webhook payment.canceled / payment.failed
                                       │
                                       ▼
                          webhook + reconcile-cron parse:
                          NEW: metadata.cancellation = { party, reason }
                          NEW: metadata.payment_method = { type, card_*, sbp_bank_id }   [change #3]
                                       │
                ┌──────────────────────┼─────────────────────────┐
                ▼                      ▼                         ▼
   ?payment=failed in return-url   Lazy: any signed-in        cron (5 min):
   → RetryModal shows immediately  page checks for last       fetch failed/canceled rows
                                   failure <30min →           with tg_bot_chat_id, no
                                   RetryModal lazy            tg_recovery_sent, no later
                                                              succeeded, age 5min-24h
                                                              → POST bot/internal/
                                                                  payment-recovery       [change #4]
                                                              → DM with SBP retry link
                                       │
                                       ▼
              /admin/finance/payment-failures
              — reasons distribution, method success%,
                recovery funnel                                        [change #5]
```

---

## Telemetry data shape

### YooKassa payload (what we now parse, currently dropped)

```json
{
  "event": "payment.canceled",
  "object": {
    "id": "2f5b...",
    "status": "canceled",
    "cancellation_details": {
      "party": "payment_network",
      "reason": "insufficient_funds"
    },
    "payment_method": {
      "type": "bank_card",
      "card": {
        "first6": "220070",
        "last4": "1234",
        "card_type": "MasterCard",
        "issuer_country": "RU",
        "issuer_name": "TINKOFF BANK"
      },
      "sbp": { "bank_id": "100000000007" }
    }
  }
}
```

### `billing_payments.metadata` jsonb after this release

```json
{
  "cancellation": {
    "party": "payment_network",
    "reason": "insufficient_funds",
    "filled_at": "2026-05-22T14:30:00Z"
  },
  "payment_method": {
    "type": "bank_card",
    "card_first6": "220070",
    "card_last4": "1234",
    "card_issuer_country": "RU",
    "card_issuer_name": "TINKOFF BANK",
    "sbp_bank_id": null
  },
  "pricing_variant": "B",
  "recovery_from": "<old_payment_uuid_or_omitted>",
  "recovery_method_used": "site_modal | tg_dm | organic_retry | null",
  "sbp_preselected": true,
  "tg_recovery_sent": "2026-05-22T14:35:12Z",
  "tg_user_id": 999170
}
```

### Reason mapping (single source of truth)

`src/server/modules/billing/cancellation-reasons.ts`:

| YK reason                   | Human RU                         | Suggest method     |
| --------------------------- | -------------------------------- | ------------------ |
| `insufficient_funds`        | На карте не хватило средств      | retry same         |
| `payment_method_restricted` | Банк не разрешает онлайн-оплаты  | sbp                |
| `card_expired`              | Срок действия карты истёк        | sbp / другая карта |
| `country_forbidden`         | Карта из неподдерживаемой страны | sbp                |
| `3d_secure_failed`          | Не прошла проверка 3-D Secure    | sbp                |
| `general_decline`           | Банк отклонил без объяснений     | sbp                |
| `expired_on_confirmation`   | Не успели подтвердить за час     | retry              |
| `expired_on_capture`        | Сорвался захват средств          | retry              |
| `canceled_by_merchant`      | Отменено системой                | retry              |
| `permission_revoked`        | Отозваны права на оплату         | sbp                |
| `internal_timeout`          | Технический сбой YooKassa        | retry              |
| `fraud_suspected`           | Подозрение на фрод               | поддержка          |
| (default unknown)           | Платёж не прошёл                 | sbp                |

This same table powers retry-modal, bot DM, and admin grouping.

---

## Change #1 — YooKassa createPayment

`src/server/modules/billing/yookassa.ts`:

```ts
interface CreatePaymentParams {
  // ...existing fields unchanged
  paymentMethodType?: 'sbp' | 'bank_card' | 'yoo_money' | 'sber_b2b' | 'tinkoff_bank';
}

// in body construction:
if (params.paymentMethodType) {
  body.payment_method_data = { type: params.paymentMethodType };
}
```

Fallback if YK rejects unsupported method:

```ts
try {
  return await callYK(bodyWithSbp);
} catch (err) {
  if (isUnsupportedMethodError(err)) {
    console.warn('[billing] SBP not configured in YK shop, falling back to default');
    return await callYK(bodyWithoutPaymentMethodData);
  }
  throw err;
}
```

Recurring renewals (`cron/renew-due-subscriptions`) are **not** touched — they use a saved `payment_method_id` for server-initiated capture, no user screen, method irrelevant.

---

## Change #2 — DB row metadata at payment creation

`src/business/server/lambda-routers/topUp.ts` and `subscription.ts` both call `createYookassaPayment` and insert a `billing_payments` row. Both now:

```ts
const tgChatId = await db.select({ tgBotChatId: userBilling.tgBotChatId })
  .from(userBilling).where(eq(userBilling.userId, ctx.userId)).then(r => r[0]?.tgBotChatId);

const payment = await createYookassaPayment({
  ...,
  paymentMethodType: 'sbp',
  metadata: { pricing_variant: variant },
});

await db.insert(billingPayments).values({
  ...,
  metadata: {
    pricing_variant: variant,
    sbp_preselected: true,
    tg_user_id: tgChatId ?? null,
  },
});
```

---

## Change #3 — Parse YK details in webhook + reconcile

`src/app/(backend)/api/billing/webhook/route.ts`:

Extend `YookassaWebhookPayload`:

```ts
interface YookassaWebhookPayload {
  event: string;
  type: string;
  object: {
    id: string;
    status: string;
    metadata?: Record<string, string>;
    cancellation_details?: { party: string; reason: string };
    payment_method?: {
      type?: string;
      id?: string;
      saved?: boolean;
      card?: {
        first6?: string;
        last4?: string;
        card_type?: string;
        issuer_country?: string;
        issuer_name?: string;
      };
      sbp?: { bank_id?: string };
    };
  };
}
```

New helper `src/server/modules/billing/parse-yk-payload.ts`:

```ts
export function extractMetadataPatch(obj: YookassaWebhookPayload['object']) {
  const patch: Record<string, unknown> = {};
  if (obj.cancellation_details) {
    patch.cancellation = {
      party: obj.cancellation_details.party,
      reason: obj.cancellation_details.reason,
      filled_at: new Date().toISOString(),
    };
  }
  if (obj.payment_method) {
    patch.payment_method = {
      type: obj.payment_method.type ?? null,
      card_first6: obj.payment_method.card?.first6 ?? null,
      card_last4: obj.payment_method.card?.last4 ?? null,
      card_issuer_country: obj.payment_method.card?.issuer_country ?? null,
      card_issuer_name: obj.payment_method.card?.issuer_name ?? null,
      sbp_bank_id: obj.payment_method.sbp?.bank_id ?? null,
    };
  }
  return patch;
}
```

Apply patch via SQL merge (`metadata = metadata || $patch::jsonb`) in both webhook handler (for any event) and reconcile cron (when `yk.status` is fetched and known).

Reconcile cron's existing `fetchYookassaPaymentStatus` is extended to return the full YK payment object (currently returns just `status` and `paymentMethodId`).

---

## Change #4 — Site Retry Modal

New feature: `src/features/PaymentRetry/RetryModal.tsx`.

**Trigger conditions** (in order, first match wins):

1. URL contains `?payment=failed` or `?payment=canceled` → show immediately.
2. tRPC `billing.getRecentFailure` returns a row `status in ('failed','canceled')` with `created_at > now() - 30min` and the user has not dismissed for that `payment_id` (localStorage key `retry_modal_dismissed_<paymentId>`) → show on first signed-in page render.

**Suppression**:

- On `/settings/plans` (already shows pricing UI; modal would be redundant).
- On `/admin/*`.
- If `tg_recovery_sent` is set on the row (bot DM already covered the user).

**Content**:

```
💳  Платёж не прошёл                                  ✕

{reasonHuman from cancellation-reasons.ts}
Например: "На карте не хватило средств"

Метод который не сработал:
💳  Mastercard •• 1234 (TINKOFF BANK)
    (or 📱 СБП — Тинькофф / 🟡 ЮMoney / …)

──────────────────────────────────

Попробуй СБП — оплата через QR в банковском
приложении, без 3-D Secure, проходит у 95% карт.

[ 📱  Оплатить через СБП — 490 ₽ ]

Или попробуй другой способ →

──────────────────────────────────

Не получается? Напиши в бот @gptwebrubot —
поможем оплатить вручную или вернём кредиты.
```

**Actions**:

- "Оплатить через СБП" → calls `topUp.purchase` / `subscription.start` (same parameters as failed payment row: `amount_rub`, `plan_id`, `tokens_amount`) with `paymentMethodType: 'sbp'` and `metadata.recovery_from: <old_payment_id>`, `metadata.recovery_method_used: 'site_modal'`. Redirect to new YK URL.
- "Другой способ" → same mutation but `paymentMethodType: undefined` (no preselect).
- "Напиши в бот" → plain `<a href="https://t.me/gptwebrubot?start=help_payment_<paymentId>">`. Bot resolves `/start help_payment_*` to a manual support flow (existing path).
- "✕" close → `localStorage.setItem('retry_modal_dismissed_' + paymentId, '1')`.

**Mount point**: `src/app/[variants]/(main)/_layout/index.tsx`, alongside other globals. Self-gating — renders null if conditions don't match.

---

## Change #4b — Telegram Recovery DM

New cron: `src/app/(backend)/api/cron/payment-recovery-notify/route.ts`. Triggered every 5 minutes by host crontab with `Bearer CRON_SECRET`.

**Query**:

```sql
SELECT bp.id, bp.user_id, bp.amount_rub, bp.plan_id, bp.tokens_amount,
       bp.metadata, ub.tg_bot_chat_id, u.name
FROM billing_payments bp
JOIN user_billing ub ON ub.user_id = bp.user_id
LEFT JOIN users u ON u.id = bp.user_id
WHERE bp.status IN ('failed', 'canceled')
  AND bp.created_at > NOW() - INTERVAL '24 hours'
  AND bp.created_at < NOW() - INTERVAL '5 minutes'
  AND ub.tg_bot_chat_id IS NOT NULL
  AND (bp.metadata->>'tg_recovery_sent') IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM billing_payments bp2
    WHERE bp2.user_id = bp.user_id
      AND bp2.status = 'succeeded'
      AND bp2.created_at > bp.created_at
  )
LIMIT 50;
```

**Per-row processing**:

1. Build `retry_url_sbp` = `https://ask.gptweb.ru/api/billing/recovery-retry?payment=<id>&method=sbp&t=<hmac>` where `<hmac>` is an HMAC-SHA256 of `<paymentId>:<userId>:<expiresAtUnix>:sbp` signed with `BETTER_AUTH_SECRET`. Expiry: 24h.
2. Build `retry_url_choice` = same endpoint with `&method=any` and matching HMAC.
3. POST to `BOT_INTERNAL_URL/internal/payment-recovery` with `X-Internal-Token: BOT_INTERNAL_TOKEN`.
4. Bot returns `{sent: true, telegram_message_id}` or `{sent: false, error}`.
5. Update `metadata.tg_recovery_sent` to ISO timestamp on success, or to literal string `'blocked'` if user blocked the bot. Never retry.

**Hard caps** (anti-spam):

- Max 1 DM per user per day.
- Max 3 DM per user per week.
- Check via `COUNT(*) WHERE user_id=$1 AND metadata ?? 'tg_recovery_sent' AND filled within window`.

**Bot endpoint** in `gptwebrubot` (new): `POST /internal/payment-recovery`. Request body:

```ts
{
  tg_chat_id: number;
  payment_id: string;
  amount_rub: number;
  plan_name: string;
  tokens_amount: number;
  reason_code: string; // e.g. 'insufficient_funds'
  reason_text: string; // already RU-localized
  retry_url_sbp: string;     // fallback URL retry
  retry_url_choice: string;  // fallback URL retry (any method)
  invoice: {                  // PRIMARY recovery channel — bot sendInvoice
    title: string;            // "Оплата подписки Pro" / "Пополнение 490₽"
    description: string;      // short subtitle (under 255 chars)
    payload: string;          // opaque to Telegram, contains original_payment_id (signed HMAC)
    currency: 'RUB';
    prices: [{ label: string; amount: number }];  // amount in KOPECKS (rub * 100)
  };
}
```

Response: `{sent: true, telegram_message_id: number, channel: 'invoice' | 'url_fallback'}` | `{sent: false, error: 'blocked' | 'invalid_chat' | 'rate_limited' | 'unknown'}`.

**Two channels, bot picks one**:

1. **Primary: native Telegram invoice via `bot.api.sendInvoice`**. Single tap inside chat opens Telegram's own payment UI (card / SBP form provided by YooKassa via `TELEGRAM_PAYMENT_PROVIDER_TOKEN`). No browser, no tab, no session. Bot handles `pre_checkout_query` (always answer OK if payload signature valid) and `message.successful_payment` (forwards to aggregator's `/api/billing/telegram-payment-fulfill`). Response includes `channel: 'invoice'`.
2. **Fallback: URL inline buttons** (current spec). If `sendInvoice` fails (provider misconfigured, user blocked invoice scope, etc.) the bot drops back to the URL-button DM. Response includes `channel: 'url_fallback'`.

The aggregator's cron always sends both an `invoice` payload AND the URL fallback fields — bot decides which to use.

**DM template (invoice path)**:

User sees a Telegram-native message card:

```
😕  Видим — оплата не прошла

{emoji} {reason_text}

Можем попробовать через СБП — оплата по QR в
банковском приложении, без 3-D Secure, проходит
у 95% карт российских банков.

[ ⬇  Native Telegram invoice card ⬇ ]
┌──────────────────────────────────┐
│  💎  {plan_name}                  │
│  {tokens_amount} кредитов         │
│  ──────────────────────────────  │
│  ИТОГО:                {price} ₽  │
│                                   │
│        [ ОПЛАТИТЬ {price} ₽ ]    │
└──────────────────────────────────┘
```

**DM template (URL fallback path)** — unchanged from original spec:

```
😕  Видим — оплата не прошла

{emoji} {reason_text}

──────────────────────────────────
💎 {plan_name}                  {amount_rub} ₽
   {tokens_amount} кредитов
──────────────────────────────────

[ 🟢  Оплатить через СБП ]    ← inline URL button
[ 💳  Другой способ ]         ← inline URL button
[ ✉️  Помоги вручную ]         ← inline URL button
```

**Recovery-retry endpoint** (`GET /api/billing/recovery-retry`):

Auth: HMAC-signed URL (not session). Bot-issued links open in any browser
without requiring an existing session — the HMAC proves the bot endorsed
this specific (paymentId, userId, method) tuple within the 24h window.

Query params: `payment=<id>&method=sbp|any&t=<hmac>`.

Behavior:

1. Verify HMAC matches `HMAC-SHA256(paymentId:userId:expiresAt:method, BETTER_AUTH_SECRET)`.
   Reject 401 if invalid or expired.
2. Load original `billing_payments` row by paymentId. Reject 404 if missing.
3. Re-run the equivalent of `topUp.purchase` / `subscription.start` server-side using
   the original row's `amount_rub`, `plan_id`, `tokens_amount`, `type`. Skip the
   tRPC layer — call `createYookassaPayment` + insert row directly to avoid the
   tRPC session requirement.
4. New row metadata: `recovery_from: <oldId>`, `recovery_method_used: 'tg_dm'`
   (when `method=sbp` or `method=any` from this endpoint). Site modal sets
   `recovery_method_used: 'site_modal'` instead — modal calls the tRPC mutations
   directly with that metadata, doesn't hit this endpoint.
5. 302 redirect to the new YK confirmation URL.

The site modal does **not** use this endpoint — it has a session already and
calls the normal tRPC mutations with `metadata.recovery_method_used: 'site_modal'`.
This endpoint exists specifically for the bot-DM URL-fallback flow where
session may be absent.

---

## Change #4c — Telegram-payment fulfill bridge

When the user pays via the native Telegram invoice (the primary recovery
channel from Change #4b), the bot receives a `message.successful_payment`
update from Telegram. The bot calls our aggregator:

`POST /api/billing/telegram-payment-fulfill` with `X-Internal-Token`.

Request body:

```ts
{
  invoice_payload: string; // the HMAC-signed payload we created in cron
  telegram_payment_charge_id: string; // Telegram's payment id
  provider_payment_charge_id: string; // YooKassa's payment id
  total_amount: number; // KOPECKS (rub * 100)
  currency: 'RUB';
  tg_user_id: number; // Telegram user numeric id
}
```

Behavior:

1. Verify `X-Internal-Token` matches `BOT_INTERNAL_TOKEN`. Reject 401.
2. Parse + verify HMAC on `invoice_payload`. Extract `paymentId` (original
   failed `billing_payments` row), `userId`, and `expiresAt`. Reject 400 if
   signature invalid or expired.
3. Load original `billing_payments` row by paymentId. Reject 404 if missing
   or if it doesn't belong to the user from the payload.
4. Insert NEW `billing_payments` row with:
   - `status: 'succeeded'` (paid via Telegram, never goes through pending)
   - `type` = original.type
   - `amountRub` = original.amountRub (verify `total_amount / 100 === amountRub`, reject 400 on mismatch)
   - `tokensAmount`, `planId` = original
   - `yookassaPaymentId` = `provider_payment_charge_id` (the YK side)
   - `metadata`:
     ```json
     {
       "pricing_variant": "<copied>",
       "recovery_from": "<originalId>",
       "recovery_method_used": "tg_dm_invoice",
       "telegram_payment_charge_id": "<value>",
       "tg_user_id": <number>
     }
     ```
5. Call `fulfillPayment(db, providerPaymentId)` (existing function) to credit
   the user. This handles the user_billing balance update, sends a
   confirmation DM via the bot's normal post-payment flow, and is idempotent.
6. Return `200 {ok: true, new_payment_id: <uuid>}`.

The bot is responsible for the `pre_checkout_query` answer (must respond
within 10s). Bot answers OK as long as the invoice_payload signature is
valid (no DB lookup needed at pre-check time — verification happens at
fulfill time).

---

## Change #5 — Admin observability page

`webgpt-admin/app/(dashboard)/finance/payment-failures/page.tsx`.

5 blocks, all read-only, single page:

### Block 1 — KPI for period (7d toggle | 30d)

- Attempts | Succeeded (count + %)
- Failed | Canceled (counts)
- Recovery rate: `succeeded WHERE metadata.recovery_from IS NOT NULL` / `failed+canceled with no later succeeded`
- Lost revenue: `SUM(amount_rub) WHERE status IN (failed,canceled) AND no recovery succeeded`
- Recovered revenue: `SUM(amount_rub) WHERE status=succeeded AND metadata.recovery_from IS NOT NULL`

### Block 2 — Reason distribution

Group by `metadata->'cancellation'->>'reason'`. Count, %, avg amount, sparkline. Hint text below: if `expired_on_confirmation > 40%` highlight "users abandoning checkout"; if `payment_method_restricted + country_forbidden > 30%` highlight "card limitations — SBP-first should help".

### Block 3 — Payment method success rate

Group by `metadata->'payment_method'->>'type'`. Attempts, success%, avg ticket. **This is the primary chart for verifying SBP-first works** — expect 70%+ SBP success rate vs ≤30% card.

### Block 4 — Bank-card issuer country breakdown

Filter `payment_method.type = 'bank_card'`. Group by `card_issuer_country`. Attempts, fails, success%.

### Block 5 — Recovery funnel

```
N failed/canceled
 ├── X received site_modal exposure
 │    └── Y retried via modal      → Z succeeded
 ├── A received tg_dm
 │    └── B retried via tg_dm     → C succeeded
 └── D no recovery touch
      └── E organic retry          → F succeeded
```

Source: `metadata.recovery_method_used` on succeeded rows linked back via `metadata.recovery_from`.

### Tech

- tRPC procedure `finance.paymentFailures.summary(period)` in `webgpt-admin/lib/trpc`. Read-only.
- All queries use `metadata->>'…'` jsonb operators on the existing `billing_payments` table.
- 60-second client cache (existing admin pattern).
- No realtime updates needed for ≤40 events/month.

---

## Coordination between recovery channels

1. **Site modal** fires on `?payment=failed` redirect OR lazy check < 30 min — immediate.
2. **Bot DM cron** waits 5 minutes after payment creation (grace period for site modal to land first).
3. If user paid successfully (any method) between site modal and bot cron — `NOT EXISTS (succeeded after)` blocks the DM.
4. If `tg_recovery_sent` is set — site modal **also** suppresses (avoid double-prompt during the next session).
5. Hard caps (1/day, 3/week) prevent spam if user is hitting payment errors repeatedly.

---

## Risks and mitigations

| Risk                                             | Mitigation                                                                                                           |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| SBP not configured in YK shop — all payments 400 | Fallback in `createYookassaPayment`: try with sbp → catch unsupported → retry without `payment_method_data`. Logged. |
| User blocked the bot — DM fails silently         | Bot endpoint returns `{sent:false, error:'blocked'}` → write `tg_recovery_sent: 'blocked'` → never retry.            |
| Modal flash annoyance                            | Triggers only on `?payment=failed` OR fresh (<30 min) failure row, dismiss-once via localStorage.                    |
| Race: cron schedules DM after user already paid  | SQL `NOT EXISTS (succeeded after)` + 5-min grace.                                                                    |
| YK changes payload format                        | Defensive parsing with optional chains in `extractMetadataPatch`. Never throw on parse failure.                      |
| Recovery-retry endpoint abused                   | Session-gated, payment ownership verified, idempotency via existing YK idempotence key + DB transaction.             |

---

## Out of scope (explicit)

| Idea                                                 | Why deferred                                                                            |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Embedded YooKassa widget (in-site checkout)          | 6-10h work. Only if SBP-first + recovery doesn't reach +5/week. Separate spec.          |
| Pricing changes / new plans                          | Problem B — separate brainstorm.                                                        |
| Onboarding rebuild (Problem A — 940 users never use) | Largest pool but different pain. Separate.                                              |
| Email recovery via Brevo                             | TG-DM covers \~100% (TG auth is currently required). Email-fallback infra not worth it. |
| Cron auto-charge on saved card                       | No legal capture intent for retries. Only user-driven retry.                            |
| A/B test SBP-first vs control                        | 38 fails/mo split 50/50 → months to significance. Ship SBP to all, measure vs baseline. |
| Recovery in other channels (WhatsApp, SMS)           | TG sufficient at 100% coverage. Bloat.                                                  |

---

## Implementation summary

| #   | File                                                                                                                                                                                                                                                   | Change                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| 1   | `src/server/modules/billing/yookassa.ts`                                                                                                                                                                                                               | Add `paymentMethodType` option + fallback.                                          |
| 2   | `src/business/server/lambda-routers/topUp.ts`<br>`src/business/server/lambda-routers/subscription.ts`                                                                                                                                                  | Pass `paymentMethodType: 'sbp'`. Write `tg_user_id`, `sbp_preselected` to metadata. |
| 3   | `src/app/(backend)/api/billing/webhook/route.ts`<br>`src/app/(backend)/api/cron/reconcile-pending-payments/route.ts`<br>NEW `src/server/modules/billing/parse-yk-payload.ts`                                                                           | Parse cancellation_details + payment_method, merge into metadata.                   |
| 4   | NEW `src/features/PaymentRetry/RetryModal.tsx`<br>NEW `src/app/(backend)/api/cron/payment-recovery-notify/route.ts`<br>NEW `src/app/(backend)/api/billing/recovery-retry/route.ts`<br>NEW endpoint in `gptwebrubot` repo: `/internal/payment-recovery` | Site modal + bot DM cron + recovery-retry endpoint.                                 |
| 5   | NEW `webgpt-admin/app/(dashboard)/finance/payment-failures/page.tsx`<br>NEW tRPC procedure `finance.paymentFailures.summary`                                                                                                                           | Admin observability page.                                                           |
| 6   | NEW `src/server/modules/billing/cancellation-reasons.ts`                                                                                                                                                                                               | Reason→human mapping, shared by modal/bot/admin.                                    |
| 7   | Host crontab: add 5-min job for `payment-recovery-notify` with Bearer auth                                                                                                                                                                             | Operational.                                                                        |
| 8   | YooKassa Кабинет (manual, by Pavel): reorder methods so СБП is first                                                                                                                                                                                   | Operational, pre-deploy.                                                            |

---

## Validation plan

- **Day 0 deploy**: smoke `topUp.purchase` produces a YK URL pre-selecting SBP. Webhook handler logs the `cancellation` patch when canceled. Admin page renders.
- **Day +3**: open `/admin/finance/payment-failures`. Verify cancellation reasons are populated on new failures (old rows stay empty). Verify recovery_method_used populates on succeeded retries.
- **Day +7**: first business measurement. Recovery rate should be > 0%.
- **Day +28**: final vs baseline. Decision point: graduate to Problem B if +5/week hit, else iterate (embedded widget likely next).
