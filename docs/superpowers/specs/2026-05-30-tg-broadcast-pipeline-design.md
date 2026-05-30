# TG-broadcast pipeline — design

**Status:** approved 2026-05-30
**Scope:** Add a Telegram-bot delivery channel to the existing
broadcast-campaign system, behind the same draft → approved → active →
done state machine that drives email. Goal is a single tool that
handles promo pushes, feature announcements, and reactivation pulls
across email + TG.
**Out of scope:** A/B variants, multi-button keyboards, image upload UI
(we accept URLs), email-or-TG prioritisation (we always fan out to
every channel the campaign opts into).

## Why now

The `broadcast_campaigns` schema was already shaped for multi-channel
when it landed in May (`channels text[]`, recipients.channel, bot
content columns). Only the email side was wired up to a worker. The
bot side has 64 linked chat_ids (2.9% of users) and no way for ops to
push anything to them — every announcement currently goes only to
email, missing the channel that's both faster and more engaging for
the audience that opted into it.

## Architecture

Two repos cooperate:

- **webgpt-admin** owns campaign lifecycle, audience resolution,
  recipient queue, send-batch worker, KPI dashboard.
- **gptwebrubot** exposes one HMAC-protected internal endpoint that the
  worker calls per bot recipient.

Send-batch runs from host cron every minute, pulls up to 25 pending
recipients across all active campaigns, and dispatches each one to its
channel handler (Brevo for email, internal HTTP for bot). Recipients
for the two channels are independent rows — a user opted into both
gets two rows and two messages, no coordination between them.

```
                                            ┌───────────────────┐
                                            │  bot send queue   │
                                            │  (recipients      │
admin UI ──> draft campaign ──> resolve ──> │   channel='bot',  │ ──> POST /internal/broadcast/send
                                            │   status='pending')│      (HMAC, grammY, fan-out)
                                            └───────────────────┘
                                            ┌───────────────────┐
                                            │  email send queue │
                                            │  (recipients      │
                                            │   channel='email')│ ──> Brevo API
                                            └───────────────────┘
```

Failure isolation: bot worker errors don't block email sends in the
same batch and vice versa. Each recipient is its own transaction —
worker retries per row, doesn't roll back the batch.

## Data model

Migration `2026-05-30_broadcast_v2.sql`:

```sql
-- Replace single-string `audience` enum with structured filters that
-- support the four signals we agreed on: plan / activity / paid_ever /
-- tg_linked. Keep `audience` for backward-compat with the two existing
-- email-only campaigns; new campaigns ignore it.
ALTER TABLE broadcast_campaigns
  ADD COLUMN audience_filters jsonb NOT NULL DEFAULT '{}'::jsonb;

-- V1 supports exactly one inline button. Multi-button keyboards land
-- in V2 alongside polls; one CTA per broadcast keeps conversion math
-- simple and matches our recommendation.
ALTER TABLE broadcast_campaigns
  ADD COLUMN bot_button_label text,
  ADD COLUMN bot_button_url   text;
```

`audience_filters` shape:

```ts
{
  plan?: ('free' | 'basic' | 'pro' | 'pro_max')[],  // ANY of
  activity?: 'active_7d' | 'sleeping_8_30d' | 'churned_30d',
  paid_ever?: boolean,
  tg_linked?: boolean,
}
```

Missing key ≡ no filter. Multiple keys AND together. `plan: []` is
equivalent to missing.

`broadcast_recipients`, `broadcast_events`, and `users.broadcast_opted_out`
stay as they are.

## Audience resolution

A single SQL function `resolveCampaignAudience(filters, channels)`
returns `(user_id, email, tg_bot_chat_id)` rows. Called from the
`POST /admin/api/broadcasts/[id]/resolve-audience` endpoint when the
operator transitions the campaign from `draft` to `audience_locked`.

The function applies the four filter axes via short-circuit predicates
(an unset filter passes everyone) and additionally enforces that the
user has the contact info for at least one of the requested channels:

- For `channel='email'`: real email, not `*@bot.gptweb.ru` (those are
  synthetic Telegram-OAuth accounts).
- For `channel='bot'`: `user_billing.tg_bot_chat_id IS NOT NULL`.

Resolution writes recipients atomically: for each user, insert one row
per requested channel where the user is reachable. Snapshot semantics —
a user who later unlinks TG still gets their already-snapshot'ed bot
recipient processed (the worker will detect the missing chat_id and
mark `failed`).

Opt-out: any row with `users.broadcast_opted_out = true` is excluded at
resolution time. We do NOT check this again at send time — once a user
is in the queue, they're staying there.

## Send-batch worker

`POST /admin/api/broadcasts/send-batch` (existing route, extended):

1. Early-exit if no `status='active'` campaigns.
2. For each active campaign, compute `quota = daily_cap - sent_today`.
3. Pull up to `min(quota, 25)` pending recipients with
   `FOR UPDATE SKIP LOCKED` so concurrent cron ticks don't double-send.
4. Per recipient, dispatch by channel:
   - **email**: Brevo POST, store `brevo_message_id`, mark `sent_at`.
   - **bot**: POST to bot's `/internal/broadcast/send`, store
     `tg_message_id`, mark `sent_at`.
5. On Telegram-side errors:
   - `Forbidden: bot was blocked` → `status='failed'`, `last_error`,
     don't retry. Increment campaign-level `bot_blocked_count` (computed
     on the fly from recipients).
   - `Forbidden: user is deactivated` → same as blocked.
   - `Too Many Requests 429` → respect `retry_after`, leave row
     pending, next cron tick picks it up.
6. When `count(status='pending') = 0`, mark campaign `done`.

Telegram rate limit is 30 msg/sec global per bot. We send at most
25 per minute per cron tick, \~0.4 msg/sec — three orders of magnitude
under the limit, so we never need queue-side throttling in V1.

## Bot internal endpoint

`POST /internal/broadcast/send` on `gptwebrubot`. Headers:
`X-Internal-Token: ${BOT_INTERNAL_TOKEN}`. Body:

```ts
{
  chat_id: number,
  text: string,            // MarkdownV2-escaped on the caller side
  photo?: string,          // URL
  button?: { label: string; url: string }
}
```

Response: `{ ok: true, tg_message_id: number }` or
`{ ok: false, error: 'blocked' | 'deactivated' | 'flood:<sec>' | 'other:<msg>' }`.

Implementation uses grammY's `sendPhoto` if `photo` is set (caption
becomes the text), otherwise `sendMessage`. Inline button via
`inline_keyboard: [[{ text, url }]]`.

The URL inside `button.url` is the trackable wrapper —
`https://ask.gptweb.ru/api/broadcast/track?r=<recipient_id>&u=<dst>` —
constructed by the worker before the call. The bot doesn't know about
tracking; it just forwards.

## Tracking

| Event          | Email                                                       | Bot                                   |
| -------------- | ----------------------------------------------------------- | ------------------------------------- |
| `sent`         | Brevo 201                                                   | grammY ok                             |
| `delivered`    | Brevo webhook                                               | = sent (TG gives no signal)           |
| `opened`       | 1×1 pixel                                                   | not measurable                        |
| `clicked`      | trackable URL                                               | trackable URL (same redirect handler) |
| `paid`         | webhook fulfill correlates by promo_code + recent recipient | same                                  |
| `unsubscribed` | `/api/broadcast/unsubscribe?u=<signed>`                     | `/stop` command in bot                |

The existing `/api/broadcast/track` and `/api/broadcast/unsubscribe`
routes work as-is for both channels because they key on `recipient_id`,
not on channel.

Bot opens stay null forever — this is a real product limitation. The
KPI panel shows "n/a" for bot open rate so ops doesn't read it as 0%.

## Workflow and states

```
draft ─> audience_locked ─> approved ─> active ─> done
   ↓           ↓                ↓          ↑↓
archived  archived         archived    paused
```

State invariants:

- `draft` → editable content + filters; no recipients.
- `audience_locked` → recipients written; filters frozen; content still
  editable.
- `approved` → content frozen too; cron will pick it up at the next
  tick.
- `active` → recipients being processed.
- `paused` → cron skips this campaign; resume returns it to `active`.
- `done` → no pending recipients remain; archive is the only forward
  move.

Transitions:

- `draft → audience_locked`: `POST /resolve-audience`. Inserts recipients
  in one transaction.
- `audience_locked → draft`: `POST /unlock`. Deletes recipients
  (cascades), unfreezes filters.
- `audience_locked → approved`: `POST /approve`. Confirms intent.
  Requires typing the audience size as a confirm token if size > 500.
- `approved → active`: automatic (the campaign is now eligible for
  cron pickup). For scheduled campaigns, `scheduled_at` gates pickup.
- `active → paused` / `paused → active`: manual buttons.
- `active → done`: automatic when recipients drain.
- any → `archived`: manual.

Every transition writes a `broadcast_events` row with
`event_type='state_change'`, `payload={from, to, actor_email}`.

## UI

```
/admin/broadcasts                  list (existing)
/admin/broadcasts/new              create form (rewrite)
/admin/broadcasts/[id]             campaign page with KPI (rewrite)
/admin/broadcasts/[id]/audience    audience preview (new)
/admin/broadcasts/[id]/preview     rendered email + TG preview (new)
```

`/new` form sections:

1. **Name + channels** (multi-select email/bot).
2. **Filters** — four controls matching `audience_filters`.
3. **Email content** — subject, body HTML (existing markdown editor).
4. **Bot content** — text MarkdownV2, optional photo URL,
   optional button label + URL.
5. **Promo** — optional code + bonus credits + window hours.
6. Submit → redirect to `/[id]`.

`/[id]` shows: state, channels, KPI by channel (sent, delivered,
clicked, paid, revenue, bot_blocked_count), action buttons per state.

`/audience` shows resolved counts before approve so ops can sanity-
check filters: "64 total: 40 email (35 free + 5 paid), 24 bot (18 free

- 6 paid)".

`/preview` shows the rendered email and the rendered TG message side
by side, with mock values for `{first_name}` / `{promo_code}` so the
operator can verify formatting before approve.

## Safety

- **Approve gate for large audiences**: confirm dialog requiring the
  operator to type the recipient count if > 500. Currently with 64
  TG-linked users this is a no-op, but as the base grows it prevents
  fat-finger.
- **Pause is immediate**: cron re-reads `status='active'` before each
  recipient inside a batch loop, not just at batch start. A pause hits
  within \~1 second of the click.
- **Content frozen after approve**: every update endpoint
  (`/save-content`) checks `status IN ('draft', 'audience_locked')`.
- **No deletion of recipients post-approve**: changing the audience
  means going back to `draft` (drops recipients) and re-resolving.
  Prevents partial-state confusion.
- **Idempotent bot endpoint**: bot doesn't dedupe — that's the
  worker's job (recipient row's `status='pending'` is the lock).

## Testing

Unit (Vitest):

- `resolveCampaignAudience` — 8 tests, one per combination of present
  filters, on seed data covering free/paid users with/without TG links
  and varied last_active_at.
- `broadcast-bot-client` — mocks HTTP, verifies error mapping
  (`blocked`/`deactivated`/`flood`/`other`) and retry on 5xx.
- Send-batch — mocks Brevo + bot, verifies `sent_at`, `failed`,
  daily-cap exhaustion, multi-campaign quota independence.

Integration on staging:

- Create a draft campaign with audience_filters `{tg_linked: true}`
  and a single test chat_id forced in. Approve. Watch cron tick send
  exactly one message. Click the URL. Verify `clicked_at` updates.
  Send `/stop` to the bot. Verify `broadcast_opted_out=true`.

## Rollout

Five commits, each independently deployable:

1. **Migration** — `2026-05-30_broadcast_v2.sql`. Adds columns,
   doesn't touch existing campaigns.
2. **Backend without UI** — audience resolver, bot client, send-batch
   bot branch, bot `/internal/broadcast/send`. Smoke-test via curl
   to verify dispatch works.
3. **`/new` form** — adds bot-content editor. Ops can create draft
   campaigns but not yet approve.
4. **`/[id]` rewrite + audience/preview pages + approve/pause/resume
   endpoints**. Full lifecycle reachable.
5. **`/stop` command + unsubscribe UI parity** for bot opt-out.

Each step is reversible: revert the commit, the data model stays valid
(extra columns are harmless if unused).

## Files touched

webgpt-admin:

- `supabase-migrations/2026-05-30_broadcast_v2.sql` (new)
- `lib/broadcast-audience.ts` (new)
- `lib/broadcast-bot-client.ts` (new)
- `app/api/broadcasts/send-batch/route.ts` (extend with bot branch)
- `app/api/broadcasts/[id]/resolve-audience/route.ts` (new)
- `app/api/broadcasts/[id]/test-send/route.ts` (new)
- `app/api/broadcasts/[id]/approve/route.ts` (new)
- `app/api/broadcasts/[id]/pause/route.ts` (new)
- `app/api/broadcasts/[id]/resume/route.ts` (new)
- `app/api/broadcasts/[id]/unlock/route.ts` (new)
- `app/api/broadcasts/[id]/kpi/route.ts` (new)
- `app/(admin)/broadcasts/new/page.tsx` (rewrite)
- `app/(admin)/broadcasts/[id]/page.tsx` (rewrite)
- `app/(admin)/broadcasts/[id]/audience/page.tsx` (new)
- `app/(admin)/broadcasts/[id]/preview/page.tsx` (new)

gptwebrubot:

- internal HTTP layer — new `/internal/broadcast/send` route
- new `/stop` command handler

## Open items

- Photo upload UI vs. URL-only — V1 ships URL-only, ops uploads to
  rustfs separately. Revisit if it becomes friction.
- Variables in MarkdownV2 — `{first_name}`, `{promo_code}`,
  `{promo_expires_at}`. Worker substitutes before sending. Missing
  values render as empty string, not the literal `{first_name}`.
- Email-or-TG dedup (only one channel per user) — explicitly rejected
  in design. If revisited, add `dedup_strategy` to campaign config.
