# Email recovery flow — status check 2026-06-01

**TL;DR:** already shipped, already working. No new code needed.

## What's live

`/api/cron/payment-recovery-notify` runs every 5 min from
`/etc/cron.d/lobechat-payment-recovery`. The route has three stages:

1. **TG Stage** (commit `0500452a0a`, 2026-05-22) — DM to users with
   `tg_bot_chat_id`. 1/24h, 3/7d cap. Sends invoice (primary) or URL.
2. **Email Stage 1** (commit `bbb21b13b7`, 2026-05-23) — `sendRecoveryEmail`
   to users with `users.email`. Independent of TG, runs in parallel.
   2/7d cap (Stage 1 + Stage 2 combined).
3. **Email Stage 2** (commit `c91d50abb9`, 2026-05-23) — 24h follow-up
   email for rows whose Stage 1 already went out.

Both email stages cover 100% of payments — they don't filter by TG link.
Brevo (`BREVO_API_KEY`) configured in `/opt/lobechat/.env`.

## Proof it's running

```
metadata->>'email_recovery_sent' total 30d : 19
                            for status=failed: 0
                            for status=canceled: 19
```

19 recovery emails went out for `canceled` payments (users who reached
YK's checkout and abandoned). Zero for `failed` because no new `failed`
rows landed in the cron's 24h window — the May 10-12 cluster predates
this stage (which shipped May 23).

## Why the May 10-12 cluster got nothing

Two reasons stacked:

- Email stage didn't exist yet on May 10-12 (shipped May 23).
- The cron's window is `created_at > NOW() - INTERVAL '24 hours'`. Once
  the stage shipped, those rows were 12+ days old → out of window.

Recovery for those 19 fails is not possible after the fact: no YK payment
id exists for them, and the users have long moved on. The 1/6 that came
back did so on their own.

## What changes after diagnostic patch 68019d9e70

Diagnostic patch (`subscription.createPayment` / `topUp.createPayment`)
now writes `create_error` into `metadata` before re-throwing. The
billing_payments row still lands as `pending`, reconcile-pending still
upgrades it to `failed` 5 minutes later. **Email recovery picks it up
on the next 5-min tick** because the SQL filter is just `status IN
('failed','canceled')` — no special handling for create-time errors.

Net effect for the next failure cluster:

- Diagnostic visibility: cause sits in metadata, one SQL query away.
- Auto-recovery: email fires within 5-10 min of the row going `failed`.
- Cap: 2 emails per user per 7 days, so a fail-storm can't spam an inbox.

## Follow-ups NOT taken here

- Window widening (24h → 72h) — fine in theory but the cron has been
  running every 5 minutes for over a week without any backlog, so the
  24h window is more than enough headroom.
- Recovery-effectiveness metric (succeeded / emails_sent) — worth
  tracking once we have enough volume. Current sample (19 emails, all
  canceled, unknown conversion downstream) is too thin to publish.
