# 21 failed payments / 29 290 ₽ — root cause and follow-up

**Status:** resolved retrospectively. The defect that produced them was
patched on May 11, 2026 (commit d012d24180) before the audit started.

## Symptom

Daily ops audit on 2026-06-01 found 21 `billing_payments.status='failed'`
rows over the previous 30 days, totalling 29 290 ₽ of lost revenue.
Distribution:

| Date  | Fails |                   Lost ₽ |
| ----- | ----: | -----------------------: |
| 05-10 |     2 |                      980 |
| 05-11 |     8 |                        ? |
| 05-12 |     9 |                        ? |
| 05-22 |     2 | 3 480 (admin self-tests) |

All 21 rows shared the same hostile signature:

- `yookassa_payment_id IS NULL`
- `metadata->>'cancellation_reason'` empty
- `metadata->>'error'` empty
- Only `pricing_variant` present in metadata
- `reconcile-pending-payments` moved them `pending → failed` after the
  5-minute grace expired with no YK id ever attached

## Root cause

`subscription.createPayment` (`src/business/server/lambda-routers/
subscription.ts`) called `createYookassaPayment` with
`save_payment_method: true` hard-coded. The YooKassa merchant account did
not yet have recurring-payments approval, so YK rejected every call with
`403 forbidden / "This store can't make recurring payments"`. The
exception bubbled up unhandled, the `billing_payments` row stayed pinned
at `pending`, the cron buried it as `failed` 5 minutes later.

The defect existed in production from the addition of subscriptions until
\~2026-05-11 18:35 MSK, when commit `d012d24180` ("gate save_payment_method
behind YOOKASSA_RECURRING_ENABLED") moved the flag behind an env switch
and shipped with the env at `0`. Once recurring was approved on the
YooKassa side, ops flipped `YOOKASSA_RECURRING_ENABLED=1` and the path
became healthy.

Verification on 2026-06-01: direct POST to YK `/v3/payments` with
`save_payment_method=true` returns 200 with a working `confirmation_url`
(the test #3 we ran during the audit). End-to-end pathway is now sound.

## What we kept

Even though the original defect is fixed, the same shape (YK throws,
billing_payments row dies silently) can recur from other causes (network
blip, store credential rotation, new payment_method_data rejection).
Commit `68019d9e70` wraps the YK call in `subscription.createPayment` and
`topUp.createPayment` and patches `billing_payments.metadata` with:

```json
{
  "create_error": "<exception message, ≤500 chars>",
  "create_error_at": "<ISO timestamp>",
  "create_error_source": "subscription.createPayment | topUp.createPayment"
}
```

Re-throws the original exception so the client sees the real error. Next
time a fail cluster appears in the daily report, the cause is one SQL
query away.

## Follow-ups not done here

- The 21 historical rows are not "recoverable": YK never had a payment
  id for them, so we can't reach back out to retry. Of the 6 unique
  users, 1 succeeded on a later attempt (recovery rate \~17%). The other
  5 are gone; revenue is gone.
- `payment-recovery-notify` cron only fires for users with
  `ub.tg_bot_chat_id IS NOT NULL`. That filter cut out most of the
  affected users (only 2 of 21 got a recovery TG). Worth a follow-up:
  fall back to email recovery via Brevo for users without TG bot linked.
  Estimated lift: 5-7 of 19 abandoned users on a typical cluster.
