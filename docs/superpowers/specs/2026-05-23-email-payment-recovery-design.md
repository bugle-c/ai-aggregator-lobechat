# Email Payment Recovery Channel — Design Spec

**Status:** Approved (2026-05-23)
**Owner:** WebGPT billing
**Related:** `docs/superpowers/specs/2026-05-22-payment-failure-recovery-design.md` (TG channel)

## Problem

Telegram recovery DMs cover only \~33% of paying-funnel users — the rest never linked TG via OAuth and stay invisible to the recovery cron. New failures we observe daily (e.g. `oot@magadanteploset.ru`, 490 ₽, `insufficient_funds`) drop out of the funnel with zero follow-up. Every untouched failure is a lost \~₽490–2990 sale.

Email is the only channel we have for 100% of the base.

## Goal

Send a recovery email to every user whose payment ends up `failed` or `canceled`, in a way that:

- arrives fast enough that the user still remembers the intent (≤10 min after failure)
- circles back once 24 h later for forgetful users
- never spams more than 2 reminders per user per week
- gives the user one click to resume the same order (HMAC-signed URL → existing `/api/billing/recovery-retry` endpoint)
- is written with personality (light humor) so it reads like a friendly nudge, not a dunning notice

Success measure: lift weekly paid conversions by ≥ +3/week within 4 weeks of launch, attributable via `metadata.recovery_method_used = 'email_stage1' | 'email_stage2'`.

## Non-Goals

- Onboarding emails, lifecycle drip, expiry reminders — separate systems
- Adding new auth flows or transactional email vendors (we keep Brevo SMTP)
- Changes to YK side, webhook signing, or fulfill pipeline
- Reworking the TG channel (it stays, untouched)

## User Flow

1. User attempts payment → YK returns `canceled` or `failed`, webhook lands the row.
2. Within 5 min the row sits idle (the existing 5-min grace window).
3. Cron tick (≤5 min later) picks it up:
   - Builds a personal `recovery URL` (HMAC token, `exp = now + 7d`, `method = 'any'`)
   - Composes the **Stage 1 email** — humorous, references the failure reason
   - Sends via existing Brevo SMTP relay
   - If `user_billing.tg_bot_chat_id IS NOT NULL`: ALSO sends the TG invoice (existing flow)
   - Stamps `metadata.email_recovery_sent = NOW()`
4. ≥24 h later, if `status` is still not `succeeded` and `email_recovery_followup_sent IS NULL`:
   - Composes the **Stage 2 email** — different tone, slightly more cheeky, same URL re-signed if still within the original 7-day window (else re-issued fresh)
   - Sends email only (no second TG DM)
   - Stamps `metadata.email_recovery_followup_sent = NOW()`
5. User clicks → `/api/billing/recovery-retry` verifies HMAC, mints a fresh YK payment, redirects to confirmation URL. Standard webhook path applies on success.

## Anti-Spam Caps (hard rules)

| Rule                                                             | Enforcement                                                                                                                                              |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Stage 1 email per `payment_id`                                 | `metadata.email_recovery_sent IS NULL` filter in SQL                                                                                                     |
| 1 Stage 2 email per `payment_id`                                 | `metadata.email_recovery_followup_sent IS NULL` filter                                                                                                   |
| 2 emails per `user_id` per rolling 7 days (counting both stages) | `COUNT(*) FILTER (WHERE (metadata->>'email_recovery_sent') > NOW()-7d OR (metadata->>'email_recovery_followup_sent') > NOW()-7d)` per user must be `< 2` |
| If user clicks unsubscribe (future)                              | Hard skip — TBD when unsubscribe link lands                                                                                                              |

The cap-check runs once per cron tick after the eligibility query, before each send, identical pattern to the existing TG capacity logic.

## Architecture

**Strategy:** extend the existing `payment-recovery-notify` cron rather than spawn a parallel service. The eligibility query, grace window, and 24 h horizon already match what we need for Stage 1. Stage 2 needs a second SQL pass with a different filter — small addition, same file.

```
cron tick (every 5 min)
├─ Stage 1 batch:
│   eligible = failed/canceled
│             AND created_at IN [NOW()-24h, NOW()-5min]
│             AND email_recovery_sent IS NULL
│             AND NOT EXISTS (later succeeded)
│   for each user, apply 7d-cap:
│     send Stage 1 email
│     if tg_bot_chat_id present: send TG DM (existing flow, untouched)
│     stamp email_recovery_sent
├─ Stage 2 batch:
│   eligible = failed/canceled
│             AND created_at > NOW() - 7d            (outer bound — never resurrect old failures)
│             AND (metadata->>'email_recovery_sent')::timestamptz < NOW() - 24h
│             AND email_recovery_followup_sent IS NULL
│             AND status != 'succeeded'              (re-checked at send time)
│             AND NOT EXISTS (later succeeded)
│   apply 7d-cap, send Stage 2 email, stamp email_recovery_followup_sent
```

Stage 2 uses an open-ended "≥24 h since Stage 1 sent" rather than a narrow 1 h window — that way a cron outage of any reasonable length can't cause Stage 2 to be silently skipped. The 7-day `created_at` outer bound prevents resurrecting truly old failures.

## File Structure

| File                                                                   | Responsibility                                                                                                                                                                                            |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/server/modules/billing/email-templates/recovery.ts` (new)         | Pure function `buildRecoveryEmail({payment, reasonCode, recoveryUrl, stage}) → {subject, html, text}`. Selects copy variant by `(reasonCode, stage)`. No I/O. Trivially unit-testable.                    |
| `src/server/modules/billing/email-templates/recovery.test.ts` (new)    | Snapshot tests covering every (reasonCode × stage) combination. Verifies subject contains expected keywords, html escapes user data, URL is preserved verbatim.                                           |
| `src/server/modules/billing/email-templates/recovery-copy.ts` (new)    | The actual Russian copy — `Record<ReasonCode, {stage1: CopyBlock, stage2: CopyBlock}>` + a fallback for unknown reasons. Separated so non-engineers can review/edit copy without touching template logic. |
| `src/server/modules/billing/send-recovery-email.ts` (new)              | Thin wrapper over `sendLifecycleEmail` — accepts (payment row, stage), builds template, sends, returns `{ok, messageId, error}`. Logs and swallows errors (parity with `sendLifecycleEmail` contract).    |
| `src/server/modules/billing/send-recovery-email.test.ts` (new)         | Mock `sendLifecycleEmail`, assert correct subject/url passed through.                                                                                                                                     |
| `src/app/(backend)/api/cron/payment-recovery-notify/route.ts` (extend) | Add Stage 1 email send next to the existing TG DM, add Stage 2 second-pass SQL + send loop. Cap check extended to count email sends.                                                                      |

Total: 4 new files (\~250 LOC including tests), 1 file extended (\~80 LOC added).

## Copy / Tone

The whole point of Stage 2 emails is that they're a follow-up — they need to feel _different_ from Stage 1 or they read as a dumb robot resending the same thing.

**Voice rules:**

- Light humor — one funny line per email, never two. Self-deprecating about the payment failure, never about the user.
- Russian, conversational, no marketing-speak. No "Уважаемый пользователь".
- Subject lines are descriptive + slightly personal: "Не дожали на 490 ₽" beats "Payment recovery". Stage 2 subjects acknowledge the gap: "Прошли сутки, а вы всё ещё без подписки 🙃".

**Copy block per reason × stage:**

```ts
// recovery-copy.ts shape
type CopyBlock = {
  subject: string; // <60 chars, can include 1 emoji
  reasonHook: string; // 1-2 sentences naming what happened
  humorLine: string; // 1 sentence with personality
  ctaLabel: string; // button text, defaults to "Попробовать ещё раз — N ₽"
};
```

Stage 1 examples (Russian, kept short for the spec):

- `insufficient_funds.stage1`: "На карте не хватило денег. Бывает — кошелёк сегодня застенчивый." → CTA "Попробовать с другой карты — N ₽"
- `expired_on_confirmation.stage1`: "Открыли форму оплаты и закрыли — что-то отвлекло?" → "У нас тут специально для вас всё ещё горячо."
- `3ds_failed.stage1`: "Банк не пропустил 3D-Secure. Не паникуем — попробуем ещё раз."
- `card_expired.stage1`: "Срок карты вышел. Заведите следующую — мы подождём."
- `_default.stage1`: "Оплата сорвалась — не знаем точно почему, но точно не из-за вас." → "Попробуем ещё раз?"

Stage 2 same reasons, different copy:

- `insufficient_funds.stage2`: "Прошли сутки. Карта уже отошла от шока? 😅 Попробуем ещё раз — на этот раз получится."
- `expired_on_confirmation.stage2`: "Вчера так и не успели — может, сегодня соберёмся? Мы припрятали для вас тот же тариф."
- `_default.stage2`: "Это последнее наше письмо по этой попытке оплаты — не хотим спамить. Если ещё актуально:"

Full copy table lives in `recovery-copy.ts`. The spec doesn't enumerate every reason — that's a code review surface.

## Data Model

No schema migrations. All state lives in `billing_payments.metadata` JSONB:

```json
{
  "email_recovery_followup_sent": "2026-05-24T15:09:21.331Z",
  "email_recovery_followup_sent_messageid": "<...@gptweb.ru>",
  "email_recovery_sent": "2026-05-23T15:04:18.512Z",
  "email_recovery_sent_messageid": "<5120a30d-...@gptweb.ru>",
  "recovery_method_used": "email_stage1" // populated by fulfill path when payment derived from this URL
}
```

The fulfill-path attribution (`recovery_method_used`) already exists; we add two new enum values: `email_stage1`, `email_stage2`. The recovery-retry endpoint reads `t.method` (existing field) and we will piggyback the stage in the HMAC payload as an extra claim.

**HMAC payload change:** add optional `source?: 'tg_dm' | 'email_stage1' | 'email_stage2'` field to `RecoveryPayload`. Backward-compatible: existing tokens without `source` still verify. New tokens carry it; the retry endpoint stamps `metadata.recovery_method_used = source` on the new payment.

## Sender Identity

- From: `WebGPT <noreply@gptweb.ru>` (SMTP_FROM already verified for SMTP relay)
- Reply-To: `support@gptweb.ru` (optional — only if needed; YAGNI for v1)
- DKIM/SPF: already configured on `gptweb.ru` (we send transactional via Brevo SMTP for months)
- Brevo plan: Free, 300/day. Even at 50 failures/day × 2 stages = 100 emails/day — comfortably within limits.

## Error Handling

- Brevo SMTP failure → log, do NOT stamp `email_recovery_sent`. Next cron tick re-tries (idempotent because the stamp acts as the dedupe key).
- HMAC URL generation fails → impossible without `AUTH_SECRET`, which the cron already validates at start (existing check).
- Brevo "bounce" / "spam complaint" callbacks — out of scope for v1. Track manually via Brevo dashboard the first 2 weeks. If bounce rate >5%, revisit.
- User clicks link with expired HMAC → existing recovery-retry endpoint returns 410 with a Russian-language page (already implemented).

## Observability

Add three columns to the admin `/finance/payment-failures` table (under task T16):

| Column        | Source                                                                            |
| ------------- | --------------------------------------------------------------------------------- |
| Email Stage 1 | `metadata.email_recovery_sent` (timestamp or "—")                                 |
| Email Stage 2 | `metadata.email_recovery_followup_sent`                                           |
| Recovered via | `metadata.recovery_method_used` ∈ {tg_dm, email_stage1, email_stage2, site_modal} |

Atribution dashboard (a basic SQL view) — already planned post-launch, this just adds new method values to the existing pie chart.

## Testing Strategy

1. **Unit:** `recovery.test.ts` covers every reason × stage combination with snapshot tests. Subject, html, text all asserted.
2. **Unit:** `send-recovery-email.test.ts` mocks the sender, asserts the right template is selected and URL is preserved.
3. **Integration:** one curl against a test payment_id in dev: full cron tick, verify Brevo SMTP receives the email (via Brevo log).
4. **Production smoke:** day-1 — manually stamp `email_recovery_sent = NOW()-25h` on one test payment, watch Stage 2 fire on next cron tick.
5. **Manual review:** product owner reads every (reason × stage) copy variant before launch. Humor lines are the riskiest surface — easy to write something tone-deaf.

## Rollout

1. Land code on `canary`, deploy to prod (build is \~2 min).
2. Manually mark all existing eligible rows as `email_recovery_sent = '2026-05-23'` so they don't get back-spammed. (One-off SQL.)
3. Wait for next natural failure (≤ 24 h based on current rate). Watch logs, verify delivery.
4. Day-3 check: how many email-attributable retries succeeded?
5. Week-1 retrospective: bounce rate, complaints, conversion lift.

## Open Questions (resolved during brainstorming)

- ✅ Send to TG-linked users too? **Yes — email everyone.**
- ✅ Stage 2 also via TG? **No — Stage 2 is email only.**
- ✅ Two-stage timing? **5 min + 24 h.**
- ✅ Unified template vs per-reason? **Unified shell, per-(reason, stage) copy variants.**
- ✅ Caps? **1 per payment per stage + 2 per user per week.**

## Risks

- **Copy tone misfire** — light humor on a payment-failure topic is sharp. Mitigation: product owner reviews every variant before merge. Easy revert (text-only change).
- **Brevo daily cap (300)** — at 100 emails/day we're safe, but if failure rate triples we hit the cap. Mitigation: monitor Brevo dashboard, upgrade plan if approaching 70% utilization for 3 consecutive days.
- **Treating email as primary may delay TG send for TG-linked users** — solved by parallel sends inside the same cron loop (not sequential).
