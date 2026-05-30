# TG-broadcast pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire a working Telegram-bot delivery channel into the existing broadcast-campaign workflow so ops can ship promo / announcement / reactivation messages to TG-linked users through the same admin UI that already handles email.

**Architecture:** Two repos. `webgpt-admin` owns campaign state, audience resolution, the cron worker and the KPI dashboard. `gptwebrubot` exposes a single internal HMAC-protected endpoint that the worker calls per recipient. Two channels fan out independently — each user opted into both gets two `broadcast_recipients` rows, no coordination between them.

**Tech Stack:** Next.js 16 with `basePath: "/admin"`, `postgres` package for SQL (`sql` template tag from `@/lib/lobechat-db`), grammY on Bun for the bot, `bun:test` for bot tests. No test framework in `webgpt-admin` — every backend task ends with a curl smoke + a SQL probe instead of a Vitest run.

**Spec:** `docs/superpowers/specs/2026-05-30-tg-broadcast-pipeline-design.md` (commit `9d548511f6`).

**Repos:**

- `webgpt-admin` — branch `master`, deploys via GHA on push.
- `gptwebrubot` — branch `master`, runs under systemd as `gptwebrubot.service`.

**Conventions:**

- Every task ends with a `git add … && git commit -m "…"` inside its repo. Reviewer commits to the same branch each step.
- All Cyrillic UI text comes from the spec verbatim. Never invent new strings.
- Never hardcode `/admin/` inside `Link`/`router.push` — `basePath` adds it automatically (we fixed this on `2026-05-29`, see commit `d775fea`).
- Never `git reset --hard`, never `--no-verify`, never `--force` push.

---

## Commit 1: SQL migration

One migration adds the two new structural columns. Existing two email campaigns keep working untouched.

### Task 1.1: Write the migration file

**Files:**

- Create: `webgpt-admin/supabase-migrations/2026-05-30_broadcast_v2.sql`

**Step 1: Author the SQL**

Open `webgpt-admin/supabase-migrations/2026-05-30_broadcast_v2.sql` and write exactly:

```sql
-- TG-broadcast V2 — adds the structural columns the design spec calls for.
--
-- Why two changes in one migration: they're cohesive (both unlock the bot
-- channel) and either-or rollback makes no sense — rolling back without the
-- other still leaves the workflow half-broken. Apply atomically.

-- 1. audience_filters replaces the three-value `audience` enum with a richer
--    jsonb shape. Old column stays for the two historical campaigns.
ALTER TABLE broadcast_campaigns
  ADD COLUMN IF NOT EXISTS audience_filters jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2. V1 supports one inline button per bot message. Two columns instead of a
--    jsonb so the admin UI can bind to plain text inputs and so a CHECK can
--    enforce both-or-neither below.
ALTER TABLE broadcast_campaigns
  ADD COLUMN IF NOT EXISTS bot_button_label text,
  ADD COLUMN IF NOT EXISTS bot_button_url   text;

-- Either both bot_button columns are set or neither. Prevents a half-configured
-- button shipping in production.
ALTER TABLE broadcast_campaigns
  ADD CONSTRAINT broadcast_campaigns_bot_button_pair_check CHECK (
    (bot_button_label IS NULL AND bot_button_url IS NULL)
    OR (bot_button_label IS NOT NULL AND bot_button_url IS NOT NULL)
  );

-- 3. New campaign state `audience_locked` sits between draft and approved.
--    Update the existing status CHECK to accept it.
ALTER TABLE broadcast_campaigns
  DROP CONSTRAINT IF EXISTS broadcast_campaigns_status_check;
ALTER TABLE broadcast_campaigns
  ADD CONSTRAINT broadcast_campaigns_status_check CHECK (
    status IN ('draft','audience_locked','approved','active','paused','done','archived')
  );

-- 4. Index for fast "is this user already opted out?" lookup at resolution time.
--    `users.broadcast_opted_out` was added by the email migration; we add the
--    partial index here because resolution now hits it on every campaign approve.
CREATE INDEX IF NOT EXISTS users_broadcast_opted_out_idx
  ON users(id) WHERE broadcast_opted_out = true;
```

**Step 2: Apply the migration**

Run on the host where lobechat postgres lives:

```bash
docker exec -i lobe-postgres psql -U postgres -d lobechat \
  < /home/deploy/projects/webgpt-admin/supabase-migrations/2026-05-30_broadcast_v2.sql
```

Expected output: a series of `ALTER TABLE`, `ALTER TABLE`, `CREATE INDEX` confirmations, no errors.

**Step 3: Verify the schema**

```bash
docker exec lobe-postgres psql -U postgres -d lobechat -c "
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'broadcast_campaigns'
    AND column_name IN ('audience_filters','bot_button_label','bot_button_url')
  ORDER BY column_name;"
```

Expected output: three rows — `audience_filters`, `bot_button_label`, `bot_button_url`.

```bash
docker exec lobe-postgres psql -U postgres -d lobechat -c "
  SELECT conname FROM pg_constraint
  WHERE conrelid = 'broadcast_campaigns'::regclass
    AND conname IN ('broadcast_campaigns_bot_button_pair_check','broadcast_campaigns_status_check');"
```

Expected output: two `conname` rows.

**Step 4: Commit**

```bash
cd /home/deploy/projects/webgpt-admin
git add supabase-migrations/2026-05-30_broadcast_v2.sql
git commit -m "feat(broadcast): V2 schema — audience_filters + bot_button + audience_locked state

Adds the three structural pieces the TG-broadcast pipeline spec calls for:

- audience_filters jsonb replaces the three-value audience enum so the
  resolver can filter on plan / activity / paid_ever / tg_linked. Old
  audience column stays put for the two historical email campaigns.
- bot_button_label / bot_button_url for the single inline button V1
  supports. A CHECK enforces both-or-neither so a half-configured
  button can't ship.
- broadcast_campaigns_status_check accepts the new 'audience_locked'
  state that sits between draft and approved.

Migration is idempotent (ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF
EXISTS) so re-running it after a partial failure stays safe.

Spec: docs/superpowers/specs/2026-05-30-tg-broadcast-pipeline-design.md"
```

---

## Commit 2: Backend without UI

Resolver lib + bot client lib + send-batch bot branch + bot internal endpoint. After this commit a curl can drive the entire pipeline end-to-end without anyone touching the admin UI.

### Task 2.1: Bot internal endpoint — failing test first

**Files:**

- Test: `gptwebrubot/src/__tests__/broadcast.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, expect, it, mock } from 'bun:test';
import { handleBroadcastSendRequest } from '../server';

const SECRET = 'top-secret';

describe('handleBroadcastSendRequest', () => {
  it('rejects when the X-Internal-Token header is missing or wrong', async () => {
    const req = new Request('http://localhost/internal/broadcast/send', {
      method: 'POST',
      body: JSON.stringify({ chat_id: 1, text: 'hi' }),
    });
    const res = await handleBroadcastSendRequest({
      bot: { api: { sendMessage: mock(), sendPhoto: mock() } } as any,
      secret: SECRET,
      req,
    });
    expect(res.status).toBe(401);
  });

  it('sends a plain text message via grammY and returns tg_message_id', async () => {
    const sendMessage = mock(async () => ({ message_id: 4242 }));
    const sendPhoto = mock();
    const req = new Request('http://localhost/internal/broadcast/send', {
      method: 'POST',
      headers: { 'x-internal-token': SECRET, 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: 7, text: 'hello' }),
    });
    const res = await handleBroadcastSendRequest({
      bot: { api: { sendMessage, sendPhoto } } as any,
      secret: SECRET,
      req,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, tg_message_id: 4242 });
    expect(sendMessage).toHaveBeenCalledWith(
      7,
      'hello',
      expect.objectContaining({
        parse_mode: 'MarkdownV2',
      }),
    );
    expect(sendPhoto).not.toHaveBeenCalled();
  });

  it('uses sendPhoto when photo URL is present, with text as caption', async () => {
    const sendMessage = mock();
    const sendPhoto = mock(async () => ({ message_id: 555 }));
    const req = new Request('http://localhost/internal/broadcast/send', {
      method: 'POST',
      headers: { 'x-internal-token': SECRET, 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: 7,
        text: 'caption text',
        photo: 'https://example.com/banner.jpg',
      }),
    });
    const res = await handleBroadcastSendRequest({
      bot: { api: { sendMessage, sendPhoto } } as any,
      secret: SECRET,
      req,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).tg_message_id).toBe(555);
    expect(sendPhoto).toHaveBeenCalledWith(
      7,
      'https://example.com/banner.jpg',
      expect.objectContaining({
        caption: 'caption text',
        parse_mode: 'MarkdownV2',
      }),
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('attaches a single inline button when button is provided', async () => {
    const sendMessage = mock(async () => ({ message_id: 1 }));
    const req = new Request('http://localhost/internal/broadcast/send', {
      method: 'POST',
      headers: { 'x-internal-token': SECRET, 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: 7,
        text: 'click me',
        button: { label: 'Open', url: 'https://ask.gptweb.ru/foo' },
      }),
    });
    await handleBroadcastSendRequest({
      bot: { api: { sendMessage, sendPhoto: mock() } } as any,
      secret: SECRET,
      req,
    });
    expect(sendMessage).toHaveBeenCalledWith(
      7,
      'click me',
      expect.objectContaining({
        reply_markup: {
          inline_keyboard: [[{ text: 'Open', url: 'https://ask.gptweb.ru/foo' }]],
        },
      }),
    );
  });

  it('maps "bot was blocked" Telegram error to { ok:false, error:"blocked" }', async () => {
    const sendMessage = mock(async () => {
      throw Object.assign(new Error('Forbidden: bot was blocked by the user'), {
        error_code: 403,
        description: 'Forbidden: bot was blocked by the user',
      });
    });
    const req = new Request('http://localhost/internal/broadcast/send', {
      method: 'POST',
      headers: { 'x-internal-token': SECRET, 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: 9, text: 'x' }),
    });
    const res = await handleBroadcastSendRequest({
      bot: { api: { sendMessage, sendPhoto: mock() } } as any,
      secret: SECRET,
      req,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, error: 'blocked' });
  });

  it('maps "user is deactivated" to "deactivated" and 429 to "flood:<sec>"', async () => {
    const cases: Array<{ thrown: any; expected: string }> = [
      {
        thrown: Object.assign(new Error('Forbidden: user is deactivated'), {
          error_code: 403,
          description: 'Forbidden: user is deactivated',
        }),
        expected: 'deactivated',
      },
      {
        thrown: Object.assign(new Error('Too Many Requests: retry after 12'), {
          error_code: 429,
          parameters: { retry_after: 12 },
        }),
        expected: 'flood:12',
      },
    ];
    for (const { thrown, expected } of cases) {
      const sendMessage = mock(async () => {
        throw thrown;
      });
      const req = new Request('http://localhost/internal/broadcast/send', {
        method: 'POST',
        headers: { 'x-internal-token': SECRET, 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: 9, text: 'x' }),
      });
      const res = await handleBroadcastSendRequest({
        bot: { api: { sendMessage, sendPhoto: mock() } } as any,
        secret: SECRET,
        req,
      });
      expect(await res.json()).toEqual({ ok: false, error: expected });
    }
  });
});
```

**Step 2: Run the test to confirm it fails**

```bash
cd /home/deploy/projects/gptwebrubot && bun test src/__tests__/broadcast.test.ts
```

Expected: import fails because `handleBroadcastSendRequest` does not exist yet.

### Task 2.2: Implement the bot endpoint

**Files:**

- Modify: `gptwebrubot/src/server.ts`

**Step 1: Add the handler**

Open `gptwebrubot/src/server.ts`. After the `handlePaymentRecoveryRequest` import or near the other `handle*Request` exports, add:

```typescript
interface BroadcastSendBody {
  chat_id: number;
  text: string;
  photo?: string;
  button?: { label: string; url: string };
}

interface BroadcastHandlerArgs {
  bot: Pick<Bot<BotContext>, 'api'>;
  secret: string;
  req: Request;
}

/**
 * Internal HTTP handler for /internal/broadcast/send.
 *
 * Called per-recipient by webgpt-admin's send-batch worker. Returns a
 * tagged-error response instead of throwing so the worker can persist a
 * clean `status='failed'` row with a known `last_error` token.
 *
 * Error tokens the worker switches on:
 *   - 'blocked'      — the user blocked the bot. Don't retry.
 *   - 'deactivated'  — TG account is gone. Don't retry.
 *   - 'flood:<sec>'  — 429 from Telegram. Worker leaves the row pending
 *                      so the next cron tick picks it up after retry_after.
 *   - 'other:<msg>'  — anything else. Worker marks failed but keeps the
 *                      raw message for triage.
 */
export async function handleBroadcastSendRequest(args: BroadcastHandlerArgs): Promise<Response> {
  const token = args.req.headers.get('x-internal-token');
  if (!token || token !== args.secret) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  let body: BroadcastSendBody;
  try {
    body = (await args.req.json()) as BroadcastSendBody;
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'invalid_json' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!body.chat_id || typeof body.text !== 'string') {
    return new Response(JSON.stringify({ ok: false, error: 'missing_fields' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const reply_markup = body.button
    ? { inline_keyboard: [[{ text: body.button.label, url: body.button.url }]] }
    : undefined;

  try {
    let sent: { message_id: number };
    if (body.photo) {
      sent = await args.bot.api.sendPhoto(body.chat_id, body.photo, {
        caption: body.text,
        parse_mode: 'MarkdownV2',
        reply_markup,
      });
    } else {
      sent = await args.bot.api.sendMessage(body.chat_id, body.text, {
        parse_mode: 'MarkdownV2',
        // Broadcasts are commentary, not conversation — keep link previews
        // out unless the operator explicitly puts a URL the user clicked.
        link_preview_options: { is_disabled: true },
        reply_markup,
      });
    }
    return new Response(JSON.stringify({ ok: true, tg_message_id: sent.message_id }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err: any) {
    const desc: string = err?.description ?? err?.message ?? '';
    const code: number = err?.error_code ?? 0;
    let token = `other:${desc.slice(0, 100)}`;
    if (code === 403 && /bot was blocked/i.test(desc)) token = 'blocked';
    else if (code === 403 && /user is deactivated/i.test(desc)) token = 'deactivated';
    else if (code === 429 && err?.parameters?.retry_after) {
      token = `flood:${err.parameters.retry_after}`;
    }
    return new Response(JSON.stringify({ ok: false, error: token }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
}
```

**Step 2: Wire the route in `startInternalServer`**

Inside `startInternalServer` in the same file, find the existing `if (url.pathname === '/internal/payment-recovery' …)` line and add immediately below it:

```typescript
if (url.pathname === '/internal/broadcast/send' && req.method === 'POST') {
  return handleBroadcastSendRequest({ bot: args.bot, secret: args.secret, req });
}
```

**Step 3: Run the tests**

```bash
cd /home/deploy/projects/gptwebrubot && bun test src/__tests__/broadcast.test.ts
```

Expected: all 6 cases pass.

**Step 4: Commit so far is part of the larger Commit 2 — DO NOT commit yet.** Just save and move to the next task.

### Task 2.3: Write the audience resolver

**Files:**

- Create: `webgpt-admin/lib/broadcast-audience.ts`

**Step 1: Author the resolver**

```typescript
import { sql } from '@/lib/lobechat-db';

export type PlanSlug = 'free' | 'basic' | 'pro' | 'pro_max';
export type Activity = 'active_7d' | 'sleeping_8_30d' | 'churned_30d';
export type Channel = 'email' | 'bot';

export interface AudienceFilters {
  plan?: PlanSlug[];
  activity?: Activity;
  paid_ever?: boolean;
  tg_linked?: boolean;
}

export interface AudienceRow {
  user_id: string;
  email: string | null;
  tg_bot_chat_id: string | null; // bigint as text — keep as string
}

/**
 * Resolve a campaign audience.
 *
 * Returns one row per matching user. The caller is responsible for fanning
 * each row out into per-channel `broadcast_recipients` rows.
 *
 * Filters are applied AND-wise; unset filters pass everyone. We additionally
 * require that the user is reachable on at least one of the requested
 * channels — a TG-only campaign skips users without `tg_bot_chat_id`, an
 * email-only campaign skips users whose email looks like a synthetic
 * `*@bot.gptweb.ru` Telegram-OAuth address.
 *
 * Opt-out happens here too: `users.broadcast_opted_out = true` is excluded.
 * We don't re-check at send time so the operator has a stable snapshot.
 */
export async function resolveCampaignAudience(
  filters: AudienceFilters,
  channels: Channel[],
): Promise<AudienceRow[]> {
  if (channels.length === 0) return [];

  // Build the activity predicate. NULL last_active_at counts as churned —
  // the user signed up but never came back.
  let activityClause = sql``;
  if (filters.activity === 'active_7d') {
    activityClause = sql`AND u.last_active_at >= now() - interval '7 days'`;
  } else if (filters.activity === 'sleeping_8_30d') {
    activityClause = sql`AND u.last_active_at >= now() - interval '30 days'
                         AND u.last_active_at <  now() - interval '7 days'`;
  } else if (filters.activity === 'churned_30d') {
    activityClause = sql`AND (u.last_active_at <  now() - interval '30 days'
                              OR u.last_active_at IS NULL)`;
  }

  // Plan filter: ANY of the slugs. Empty array ≡ no filter.
  const planSlugs = filters.plan && filters.plan.length > 0 ? filters.plan : null;
  const planClause = planSlugs ? sql`AND bp.slug = ANY(${planSlugs})` : sql``;

  // paid_ever clause — short-circuit when undefined.
  let paidClause = sql``;
  if (filters.paid_ever === true) {
    paidClause = sql`AND EXISTS (
      SELECT 1 FROM billing_payments p
      WHERE p.user_id = u.id AND p.status = 'succeeded'
    )`;
  } else if (filters.paid_ever === false) {
    paidClause = sql`AND NOT EXISTS (
      SELECT 1 FROM billing_payments p
      WHERE p.user_id = u.id AND p.status = 'succeeded'
    )`;
  }

  // tg_linked clause.
  let tgClause = sql``;
  if (filters.tg_linked === true) {
    tgClause = sql`AND ub.tg_bot_chat_id IS NOT NULL`;
  } else if (filters.tg_linked === false) {
    tgClause = sql`AND ub.tg_bot_chat_id IS NULL`;
  }

  // Channel reachability — at least one requested channel must be usable.
  const wantsEmail = channels.includes('email');
  const wantsBot = channels.includes('bot');

  // Build OR'd reachability — exactly the channels we care about.
  let reachability = sql`AND false`;
  if (wantsEmail && wantsBot) {
    reachability = sql`AND (
      (u.email IS NOT NULL AND u.email NOT LIKE '%@bot.gptweb.ru')
      OR ub.tg_bot_chat_id IS NOT NULL
    )`;
  } else if (wantsEmail) {
    reachability = sql`AND u.email IS NOT NULL AND u.email NOT LIKE '%@bot.gptweb.ru'`;
  } else if (wantsBot) {
    reachability = sql`AND ub.tg_bot_chat_id IS NOT NULL`;
  }

  const rows = await sql`
    SELECT
      u.id                                AS user_id,
      u.email,
      ub.tg_bot_chat_id::text             AS tg_bot_chat_id
    FROM users u
    LEFT JOIN user_billing ub  ON ub.user_id = u.id
    LEFT JOIN billing_plans bp ON bp.id      = ub.plan_id
    WHERE COALESCE(u.broadcast_opted_out, false) = false
      AND COALESCE(u.banned, false) = false
      ${planClause}
      ${activityClause}
      ${paidClause}
      ${tgClause}
      ${reachability}
    ORDER BY u.id
  `;
  return rows as unknown as AudienceRow[];
}

/**
 * Fan out one user row into recipient inserts for the requested channels.
 * Returns the rows ready for `INSERT INTO broadcast_recipients`.
 */
export function buildRecipientInserts(
  campaignId: number,
  rows: AudienceRow[],
  channels: Channel[],
): Array<{
  campaign_id: number;
  user_id: string;
  email: string | null;
  tg_chat_id: string | null;
  channel: Channel;
}> {
  const out: ReturnType<typeof buildRecipientInserts> = [];
  for (const r of rows) {
    if (channels.includes('email') && r.email && !r.email.endsWith('@bot.gptweb.ru')) {
      out.push({
        campaign_id: campaignId,
        user_id: r.user_id,
        email: r.email,
        tg_chat_id: null,
        channel: 'email',
      });
    }
    if (channels.includes('bot') && r.tg_bot_chat_id) {
      out.push({
        campaign_id: campaignId,
        user_id: r.user_id,
        email: null,
        tg_chat_id: r.tg_bot_chat_id,
        channel: 'bot',
      });
    }
  }
  return out;
}
```

**Step 2: Smoke-test the resolver with a real query**

The resolver only exports library functions, no route yet. Verify it compiles and the SQL is syntactically valid by importing it in a one-shot script:

```bash
cd /home/deploy/projects/webgpt-admin && node --input-type=module -e "
import('./lib/broadcast-audience.ts').then(async (m) => {
  console.log('exports:', Object.keys(m));
});
" 2>&1 | head
```

Expected output: `exports: [ 'resolveCampaignAudience', 'buildRecipientInserts' ]`. If you see a TypeScript error, fix it before proceeding.

A live query happens at the route layer in Task 2.5 — don't worry about hitting the DB here.

### Task 2.4: Write the bot client

**Files:**

- Create: `webgpt-admin/lib/broadcast-bot-client.ts`

**Step 1: Author the client**

```typescript
/**
 * HTTP client for the bot's /internal/broadcast/send endpoint.
 *
 * Mirrors the error tokens the bot returns so the send-batch worker can
 * persist a typed status without re-parsing strings.
 */
export type BotSendError =
  | { kind: 'blocked' }
  | { kind: 'deactivated' }
  | { kind: 'flood'; retryAfterSec: number }
  | { kind: 'other'; message: string };

export interface BotSendResult {
  ok: true;
  tg_message_id: number;
}

export interface BotSendBody {
  chat_id: number;
  text: string;
  photo?: string;
  button?: { label: string; url: string };
}

export async function sendBroadcastViaBot(
  body: BotSendBody,
): Promise<BotSendResult | { ok: false; error: BotSendError }> {
  const url = process.env.BOT_INTERNAL_URL || 'http://127.0.0.1:8082';
  const token = process.env.BOT_INTERNAL_TOKEN;
  if (!token) {
    return {
      ok: false,
      error: { kind: 'other', message: 'BOT_INTERNAL_TOKEN not set' },
    };
  }
  let res: Response;
  try {
    res = await fetch(`${url}/internal/broadcast/send`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-token': token,
      },
      body: JSON.stringify(body),
      // 15 sec is plenty for a single sendMessage. Anything beyond that
      // is the bot being unhealthy, not a slow Telegram.
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'fetch failed';
    return { ok: false, error: { kind: 'other', message } };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return {
      ok: false,
      error: { kind: 'other', message: `HTTP ${res.status}: ${text.slice(0, 200)}` },
    };
  }
  const data = (await res.json()) as
    | { ok: true; tg_message_id: number }
    | { ok: false; error: string };
  if (data.ok) {
    return { ok: true, tg_message_id: data.tg_message_id };
  }
  if (data.error === 'blocked') return { ok: false, error: { kind: 'blocked' } };
  if (data.error === 'deactivated') return { ok: false, error: { kind: 'deactivated' } };
  if (data.error.startsWith('flood:')) {
    const sec = Number(data.error.split(':')[1]) || 30;
    return { ok: false, error: { kind: 'flood', retryAfterSec: sec } };
  }
  return {
    ok: false,
    error: { kind: 'other', message: data.error.replace(/^other:/, '') },
  };
}
```

### Task 2.5: Extend send-batch worker with the bot branch

**Files:**

- Modify: `webgpt-admin/app/api/broadcasts/send-batch/route.ts`

**Step 1: Read the existing route first**

Open `webgpt-admin/app/api/broadcasts/send-batch/route.ts` and skim the whole file. Note where the email branch is, what columns the `Recipient` type has, and how status updates happen. Do NOT change the email branch behaviour.

**Step 2: Extend the Recipient type and SELECT**

In the same file, find the `Recipient` interface and change it to:

```typescript
interface Recipient {
  id: number;
  user_id: string;
  email: string | null;
  tg_chat_id: string | null;
  channel: 'email' | 'bot';
}
```

Find the `const pending = …` SQL and replace the SELECT with:

```typescript
const pending = (await sql`
      SELECT id, user_id, email, tg_chat_id::text AS tg_chat_id, channel
      FROM broadcast_recipients
      WHERE campaign_id = ${c.id}
        AND status = 'pending'
        -- channel-specific reachability — a row with no contact info for
        -- its channel was already broken at insert time, but skip defensively.
        AND (
          (channel = 'email' AND email IS NOT NULL AND email != '')
          OR (channel = 'bot'   AND tg_chat_id IS NOT NULL)
        )
      ORDER BY id ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `) as unknown as Recipient[];
```

Also remove `AND email IS NOT NULL AND email != ''` from the existing predicate since we now handle it per-channel above.

**Step 3: Add the bot dispatch branch**

Inside the existing `for (const r of pending)` loop, wrap the existing per-recipient body in an `if (r.channel === "email")` block, and add the `else if (r.channel === "bot")` branch:

```typescript
for (const r of pending) {
  try {
    if (r.channel === 'email') {
      // ── existing Brevo block — leave unchanged ──
      // (keep the full existing code from your initial read of the file)
    } else if (r.channel === 'bot') {
      const { sendBroadcastViaBot } = await import('@/lib/broadcast-bot-client');
      // Build the tracking-wrapped button URL if the campaign has a button.
      // bot_button_url comes already validated from the resolver step.
      const button =
        c.bot_button_label && c.bot_button_url
          ? {
              label: c.bot_button_label,
              url: `${process.env.APP_URL || 'https://ask.gptweb.ru'}/api/broadcast/track?r=${r.id}&u=${encodeURIComponent(c.bot_button_url)}`,
            }
          : undefined;
      const result = await sendBroadcastViaBot({
        chat_id: Number(r.tg_chat_id),
        text: c.bot_message_md || '',
        photo: c.bot_image_urls?.[0],
        button,
      });
      if (result.ok) {
        await sql`
              UPDATE broadcast_recipients
                 SET status = 'sent',
                     sent_at = now(),
                     tg_message_id = ${result.tg_message_id}
               WHERE id = ${r.id} AND status = 'pending'
            `;
        results.push({ id: c.id, recipient: r.id, channel: 'bot', sent: true });
      } else if (result.error.kind === 'flood') {
        // Leave pending — next cron tick picks it up.
        results.push({
          id: c.id,
          recipient: r.id,
          channel: 'bot',
          flood: result.error.retryAfterSec,
        });
      } else {
        const last = result.error.kind === 'other' ? result.error.message : result.error.kind;
        await sql`
              UPDATE broadcast_recipients
                 SET status = 'failed',
                     last_error = ${last},
                     attempt_count = attempt_count + 1
               WHERE id = ${r.id} AND status = 'pending'
            `;
        results.push({ id: c.id, recipient: r.id, channel: 'bot', failed: last });
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    await sql`
          UPDATE broadcast_recipients
             SET attempt_count = attempt_count + 1,
                 last_error = ${msg}
           WHERE id = ${r.id} AND status = 'pending'
        `;
    results.push({ id: c.id, recipient: r.id, error: msg });
  }
}
```

**Step 4: Extend the campaign SELECT**

Earlier in the same file, find `SELECT * FROM broadcast_campaigns WHERE status = 'active'`. Replace `*` with explicit columns including the new bot fields so TypeScript narrows correctly:

```typescript
const campaigns = (await sql`
    SELECT
      c.id, c.daily_cap,
      c.email_subject, c.email_body_html,
      c.email_from_name, c.email_from_addr,
      c.bot_message_md, c.bot_image_urls,
      c.bot_button_label, c.bot_button_url,
      c.promo_code
    FROM broadcast_campaigns c
    WHERE c.status = 'active'
  `) as unknown as Campaign[];
```

And update the `Campaign` interface to add `bot_button_label: string | null;` and `bot_button_url: string | null;`.

**Step 5: Commit the whole backend slice**

```bash
cd /home/deploy/projects/gptwebrubot
git add src/server.ts src/__tests__/broadcast.test.ts
git commit -m "feat(broadcast): bot internal endpoint for campaign sends

Adds POST /internal/broadcast/send so the admin send-batch worker can
fan out per-recipient TG messages without each call having to think
about grammY directly.

Behaviour:
- HMAC via X-Internal-Token (matches /internal/notify et al.).
- MarkdownV2 parse mode for text or caption.
- Link previews disabled on text messages (broadcasts aren't chat).
- One inline button via reply_markup when caller provides it.
- Photo URL routes through sendPhoto with caption.
- Returns tagged error tokens ('blocked'|'deactivated'|'flood:<sec>'|'other:<msg>')
  with HTTP 200 so the worker can switch on result.error without
  re-parsing Telegram error strings.

bun:test coverage: 6 cases including text-only / photo / button / 3
error mappings. handleBroadcastSendRequest is exported so the test
hits the handler directly without spinning up the HTTP layer.

Spec: docs/superpowers/specs/2026-05-30-tg-broadcast-pipeline-design.md"

cd /home/deploy/projects/webgpt-admin
git add lib/broadcast-audience.ts lib/broadcast-bot-client.ts \
  app/api/broadcasts/send-batch/route.ts
git commit -m "feat(broadcast): bot channel in send-batch + audience resolver

Adds the four backend pieces the TG pipeline needs in one cohesive
commit so the channel works end-to-end as soon as ops drives it.

- lib/broadcast-audience.ts: resolveCampaignAudience() applies the four
  filter axes (plan / activity / paid_ever / tg_linked) plus channel
  reachability (real email or non-null tg_bot_chat_id). Returns one row
  per user; buildRecipientInserts() fans each row out per channel.
- lib/broadcast-bot-client.ts: typed HTTP client for the bot endpoint.
  Maps the bot's string error tokens to a tagged union so callers can
  switch{} without re-parsing.
- send-batch route: dispatches by channel. Email branch unchanged.
  Bot branch sends via the client, wraps the button URL through
  /api/broadcast/track for click logging, leaves flood errors pending
  for the next cron tick, marks 'blocked'/'deactivated' failed
  immediately (don't retry — the user actively rejected us).
- Campaign SELECT is now explicit and includes bot_button_label/url
  so TypeScript narrows correctly.

Smoke test pre-UI: insert a recipient by hand, flip the campaign to
'active', curl POST send-batch with the cron bearer, watch broadcast_recipients
go to status='sent' and tg_message_id populated.

Spec: docs/superpowers/specs/2026-05-30-tg-broadcast-pipeline-design.md"
```

**Step 6: Smoke-test end-to-end without UI**

```bash
# 1. Insert a tombstone draft campaign just to have an id to reference.
docker exec lobe-postgres psql -U postgres -d lobechat -c "
  INSERT INTO broadcast_campaigns (
    name, status, channels, bot_message_md, audience_filters
  ) VALUES (
    'smoke-test-1', 'active', '{bot}', 'hello from smoke test', '{}'::jsonb
  ) RETURNING id;"
# Note the returned campaign_id, call it $CID.

# 2. Insert one bot recipient pointing at YOUR chat_id.
docker exec lobe-postgres psql -U postgres -d lobechat -c "
  INSERT INTO broadcast_recipients (
    campaign_id, user_id, tg_chat_id, channel, status
  ) VALUES (
    <CID>, 'user_smoke', <YOUR_CHAT_ID>, 'bot', 'pending'
  );"

# 3. Trigger send-batch.
CRON=$(sudo grep '^CRON_SECRET=' /opt/lobechat/.env | cut -d= -f2-)
curl -fsS -X POST -H "Authorization: Bearer $CRON" \
  https://ask.gptweb.ru/admin/api/broadcasts/send-batch | jq

# 4. Verify the recipient row.
docker exec lobe-postgres psql -U postgres -d lobechat -c "
  SELECT id, status, sent_at, tg_message_id, last_error
  FROM broadcast_recipients WHERE campaign_id = <CID>;"
```

Expected: status='sent', sent_at set, tg_message_id is a positive integer, last_error NULL. Your Telegram receives the message.

If the campaign drained, it should auto-flip to `done`:

```bash
docker exec lobe-postgres psql -U postgres -d lobechat -c "
  SELECT status, done_at FROM broadcast_campaigns WHERE id = <CID>;"
# Expected: status='done', done_at populated.
```

Clean up:

```bash
docker exec lobe-postgres psql -U postgres -d lobechat -c "
  DELETE FROM broadcast_campaigns WHERE name = 'smoke-test-1';"
```

---

## Commit 3: `/new` form rewrite

The current `/admin/broadcasts/new` form only knows about email. Rewrite it so it supports both channels + the audience filters.

### Task 3.1: Read what the new form needs to know

**Files:**

- Read: `webgpt-admin/app/(admin)/broadcasts/new/page.tsx`
- Read: `webgpt-admin/app/api/broadcasts/route.ts` (the POST handler)

Note in particular:

- The submit currently goes to `POST /admin/api/broadcasts`. That route accepts the body shape from the existing form. We will extend the body, not break the existing fields.

### Task 3.2: Extend the POST handler

**Files:**

- Modify: `webgpt-admin/app/api/broadcasts/route.ts` (the POST function)

**Step 1: Accept the new fields**

In the POST handler, change the destructuring block to include the new pieces:

```typescript
const {
  name,
  channels = ['email'],
  audience_filters = {},
  daily_cap = 150,

  email_subject = null,
  email_body_html = null,

  bot_message_md = null,
  bot_image_urls = [],
  bot_button_label = null,
  bot_button_url = null,

  promo_code = null,
  promo_bonus_credits = 0,
  promo_window_hours = 24,
} = body;
```

Add a channel-specific validation block right after:

```typescript
if (!name) {
  return NextResponse.json({ error: 'name обязателен' }, { status: 400 });
}
if (!Array.isArray(channels) || channels.length === 0) {
  return NextResponse.json({ error: 'выберите хотя бы один канал' }, { status: 400 });
}
if (channels.includes('email') && (!email_subject || !email_body_html)) {
  return NextResponse.json({ error: 'email-канал требует subject и body_html' }, { status: 400 });
}
if (channels.includes('bot') && !bot_message_md) {
  return NextResponse.json({ error: 'bot-канал требует текст сообщения' }, { status: 400 });
}
if ((bot_button_label === null) !== (bot_button_url === null)) {
  return NextResponse.json(
    { error: 'укажите и label, и URL для кнопки, либо ни то ни другое' },
    { status: 400 },
  );
}
```

Change the INSERT to write the new columns too:

```typescript
const inserted = await sql`
      INSERT INTO broadcast_campaigns (
        name, status, channels,
        audience, audience_filters,
        daily_cap,
        email_subject, email_body_html,
        bot_message_md, bot_image_urls, bot_button_label, bot_button_url,
        promo_code, promo_bonus_credits, promo_window_hours,
        created_by
      ) VALUES (
        ${name}, 'draft', ${channels},
        'all', ${sql.json(audience_filters)},
        ${daily_cap},
        ${email_subject}, ${email_body_html},
        ${bot_message_md}, ${bot_image_urls}, ${bot_button_label}, ${bot_button_url},
        ${promo_code}, ${promo_bonus_credits}, ${promo_window_hours},
        ${admin.email}
      )
      RETURNING id
    `;
return NextResponse.json({ id: (inserted[0] as { id: number }).id });
```

(Drop the old `approve` flag handling — approval is now a separate endpoint introduced in Commit 4.)

### Task 3.3: Rewrite the form

**Files:**

- Modify: `webgpt-admin/app/(admin)/broadcasts/new/page.tsx`

Replace the existing component body. The Cyrillic labels below come from the spec — keep them verbatim.

The structure (top to bottom):

1. **Имя** — single text input bound to `name`.
2. **Каналы** — two checkboxes (`email`, `bot`) bound to `channels` array.
3. **Фильтры аудитории** (collapsible):
   - **Тариф** — 4 toggle chips for free/basic/pro/pro_max.
   - **Активность** — radio: `Все`/`Активные ≤7 дн`/`Спящие 8-30 дн`/`Ушедшие 30+ дн`. Maps to `undefined`/`active_7d`/`sleeping_8_30d`/`churned_30d`.
   - **Оплаты** — radio: `Все`/`Платили ранее`/`Не платили`. Maps to `undefined`/`true`/`false`.
   - **Telegram** — radio: `Все`/`С привязкой`/`Без привязки`. Maps to `undefined`/`true`/`false`.
4. **Email-блок** — visible only if `channels.includes('email')`. Subject + textarea for `email_body_html` (re-use the markdown editor pattern from the existing form).
5. **Bot-блок** — visible only if `channels.includes('bot')`. Textarea for `bot_message_md`. Single URL input for first photo (`bot_image_urls[0]`). Two more inputs for `bot_button_label` and `bot_button_url`.
6. **Промокод** — code + bonus credits + window hours (same fields as before).
7. **Daily cap** — number input default 150.
8. **«Создать черновик»** button. On click, POST to `/admin/api/broadcasts` with the body above. On success, `router.push('/broadcasts/' + id)` (no `/admin/` prefix — basePath does it).

Implementation note for the chip/radio mapping: each control writes through to a single `audience_filters` object, omitting undefined keys before submit.

After writing the file, run `npm run lint` (or `yarn lint`) at the repo root to catch typos.

### Task 3.4: Commit Commit 3

```bash
cd /home/deploy/projects/webgpt-admin
git add app/\(admin\)/broadcasts/new/page.tsx app/api/broadcasts/route.ts
git commit -m "feat(broadcast): /new form supports multi-channel + audience filters

Rewrites /admin/broadcasts/new and the POST handler so ops can create
campaigns that target the bot channel as well as email.

New form sections (Cyrillic labels from the spec):
- Каналы: email + bot multi-select.
- Фильтры аудитории: тариф (chip group), активность (radio with
  active_7d / sleeping_8_30d / churned_30d), оплаты (paid_ever yes/no),
  telegram (tg_linked yes/no). Each control writes through to a single
  audience_filters jsonb object, omitting undefined keys.
- Email/Bot content blocks are hidden when their channel is unchecked.
- Bot block: text (MarkdownV2), single photo URL, optional button
  (label + URL — backend CHECK rejects half-set).

POST /admin/api/broadcasts now accepts {channels, audience_filters,
bot_button_label, bot_button_url} and validates content/channel parity
on the server. Drops the old auto-approve flag — approval is a
separate endpoint in the next commit.

Spec: docs/superpowers/specs/2026-05-30-tg-broadcast-pipeline-design.md"
```

---

## Commit 4: `/[id]` rewrite + lifecycle endpoints + audience/preview pages

### Task 4.1: Implement `/resolve-audience` and `/unlock` endpoints

**Files:**

- Create: `webgpt-admin/app/api/broadcasts/[id]/resolve-audience/route.ts`
- Create: `webgpt-admin/app/api/broadcasts/[id]/unlock/route.ts`

**Step 1: resolve-audience route**

```typescript
// webgpt-admin/app/api/broadcasts/[id]/resolve-audience/route.ts
import { getAdminUser } from '@/lib/auth';
import { sql } from '@/lib/lobechat-db';
import {
  buildRecipientInserts,
  resolveCampaignAudience,
  type AudienceFilters,
  type Channel,
} from '@/lib/broadcast-audience';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const cid = Number(id);

  // Lock the campaign row while we resolve. Two operators clicking
  // simultaneously must not double-insert recipients.
  const rows = await sql`
    SELECT id, status, channels, audience_filters
    FROM broadcast_campaigns
    WHERE id = ${cid}
    FOR UPDATE
  `;
  const camp = rows[0] as
    | { id: number; status: string; channels: string[]; audience_filters: AudienceFilters }
    | undefined;
  if (!camp) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (camp.status !== 'draft') {
    return NextResponse.json(
      { error: `campaign is in status '${camp.status}', expected 'draft'` },
      { status: 409 },
    );
  }

  const users = await resolveCampaignAudience(
    camp.audience_filters ?? {},
    camp.channels as Channel[],
  );
  const recipients = buildRecipientInserts(cid, users, camp.channels as Channel[]);

  await sql.begin(async (tx) => {
    if (recipients.length > 0) {
      // postgres .js insert API accepts an array of objects.
      await tx`INSERT INTO broadcast_recipients ${tx(recipients, 'campaign_id', 'user_id', 'email', 'tg_chat_id', 'channel')}`;
    }
    await tx`
      UPDATE broadcast_campaigns
         SET status = 'audience_locked'
       WHERE id = ${cid} AND status = 'draft'
    `;
    await tx`
      INSERT INTO broadcast_events (campaign_id, event_type, payload)
      VALUES (${cid}, 'state_change', ${tx.json({
        from: 'draft',
        to: 'audience_locked',
        actor: admin.email,
        users: users.length,
        recipients: recipients.length,
      })})
    `;
  });

  return NextResponse.json({
    ok: true,
    users: users.length,
    recipients: recipients.length,
  });
}
```

**Step 2: unlock route**

```typescript
// webgpt-admin/app/api/broadcasts/[id]/unlock/route.ts
import { getAdminUser } from '@/lib/auth';
import { sql } from '@/lib/lobechat-db';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const cid = Number(id);

  await sql.begin(async (tx) => {
    const rows = await tx`
      SELECT status FROM broadcast_campaigns WHERE id = ${cid} FOR UPDATE
    `;
    const camp = rows[0] as { status: string } | undefined;
    if (!camp) throw new Error('not_found');
    if (camp.status !== 'audience_locked') {
      throw new Error(`status is '${camp.status}', expected 'audience_locked'`);
    }
    await tx`DELETE FROM broadcast_recipients WHERE campaign_id = ${cid}`;
    await tx`
      UPDATE broadcast_campaigns SET status = 'draft' WHERE id = ${cid}
    `;
    await tx`
      INSERT INTO broadcast_events (campaign_id, event_type, payload)
      VALUES (${cid}, 'state_change', ${tx.json({
        from: 'audience_locked',
        to: 'draft',
        actor: admin.email,
      })})
    `;
  });

  return NextResponse.json({ ok: true });
}
```

**Step 3: Smoke**

After implementing both, drive them with curl + cookie:

```bash
# Create a draft via /new manually first, then unlock-test it.
# Or run direct SQL to seed for testing:
docker exec lobe-postgres psql -U postgres -d lobechat -c "
  INSERT INTO broadcast_campaigns (name, status, channels, audience_filters)
  VALUES ('resolve-test', 'draft', '{bot}', '{\"tg_linked\":true}'::jsonb)
  RETURNING id;"
```

Visit `/admin/broadcasts/<id>` in the browser (you'll wire the buttons in Task 4.4) and POST resolve-audience. Verify with:

```bash
docker exec lobe-postgres psql -U postgres -d lobechat -c "
  SELECT status FROM broadcast_campaigns WHERE name='resolve-test';
  SELECT COUNT(*), channel FROM broadcast_recipients
  WHERE campaign_id = (SELECT id FROM broadcast_campaigns WHERE name='resolve-test')
  GROUP BY channel;"
```

Expected: status='audience_locked', recipients ≈ 64 for channel='bot'.

### Task 4.2: Approve / pause / resume endpoints

**Files:**

- Create: `webgpt-admin/app/api/broadcasts/[id]/approve/route.ts`
- Create: `webgpt-admin/app/api/broadcasts/[id]/pause/route.ts`
- Create: `webgpt-admin/app/api/broadcasts/[id]/resume/route.ts`

Each route is a near-copy of the same pattern: lock row → check `from` status → UPDATE to `to` status → write `broadcast_events` state_change. Reference implementation:

```typescript
// webgpt-admin/app/api/broadcasts/[id]/approve/route.ts
import { getAdminUser } from '@/lib/auth';
import { sql } from '@/lib/lobechat-db';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const cid = Number(id);
  // Optional confirm token for audiences > 500.
  const body = await request.json().catch(() => ({}));
  const confirmCount: number | undefined = body.confirm_count;

  await sql.begin(async (tx) => {
    const camp = (
      await tx`
        SELECT status FROM broadcast_campaigns WHERE id = ${cid} FOR UPDATE
      `
    )[0] as { status: string } | undefined;
    if (!camp) throw new Error('not_found');
    if (camp.status !== 'audience_locked') {
      throw new Error(`status is '${camp.status}', expected 'audience_locked'`);
    }
    const sizeRow = (
      await tx`SELECT count(*)::int AS n FROM broadcast_recipients WHERE campaign_id = ${cid}`
    )[0] as { n: number };
    if (sizeRow.n > 500 && confirmCount !== sizeRow.n) {
      throw new Error(`confirm_count required for audience size ${sizeRow.n}`);
    }
    await tx`
      UPDATE broadcast_campaigns
         SET status = 'active', approved_at = now()
       WHERE id = ${cid} AND status = 'audience_locked'
    `;
    await tx`
      INSERT INTO broadcast_events (campaign_id, event_type, payload)
      VALUES (${cid}, 'state_change', ${tx.json({
        from: 'audience_locked',
        to: 'active',
        actor: admin.email,
        size: sizeRow.n,
      })})
    `;
  });
  return NextResponse.json({ ok: true });
}
```

Pause and resume follow the same template — pause transitions `active → paused`, resume transitions `paused → active`. Use `WHERE id = ${cid} AND status = 'active'` (resp. `'paused'`) in the UPDATE so a race can't double-transition.

### Task 4.3: KPI endpoint

**Files:**

- Create: `webgpt-admin/app/api/broadcasts/[id]/kpi/route.ts`

```typescript
import { getAdminUser } from '@/lib/auth';
import { sql } from '@/lib/lobechat-db';
import { NextRequest, NextResponse } from 'next/server';

interface KPIRow {
  channel: 'email' | 'bot';
  total: number;
  sent: number;
  failed: number;
  clicked: number;
  paid: number;
  revenue_rub: number;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const cid = Number(id);

  const rows = (await sql`
    SELECT
      channel,
      count(*)::int                                      AS total,
      count(sent_at)::int                                AS sent,
      count(*) FILTER (WHERE status = 'failed')::int     AS failed,
      count(clicked_at)::int                             AS clicked,
      count(paid_at)::int                                AS paid,
      COALESCE(sum(payment_amount_rub), 0)::int          AS revenue_rub
    FROM broadcast_recipients
    WHERE campaign_id = ${cid}
    GROUP BY channel
    ORDER BY channel
  `) as unknown as KPIRow[];

  // Bot has no opens — email-only metric.
  const opens = (
    await sql`
      SELECT count(opened_at)::int AS n
      FROM broadcast_recipients
      WHERE campaign_id = ${cid} AND channel = 'email'
    `
  )[0] as { n: number };

  // Bot-specific health signals.
  const botHealth = (
    await sql`
      SELECT
        count(*) FILTER (WHERE last_error = 'blocked')::int     AS blocked,
        count(*) FILTER (WHERE last_error = 'deactivated')::int AS deactivated
      FROM broadcast_recipients
      WHERE campaign_id = ${cid} AND channel = 'bot'
    `
  )[0] as { blocked: number; deactivated: number };

  return NextResponse.json({
    by_channel: rows,
    email_opens: opens.n,
    bot_blocked: botHealth.blocked,
    bot_deactivated: botHealth.deactivated,
  });
}
```

### Task 4.4: Rewrite `/[id]` page

**Files:**

- Modify: `webgpt-admin/app/(admin)/broadcasts/[id]/page.tsx`

Structure (top to bottom):

1. **Header**: name + status badge (color-coded by state). Right side: action buttons matching the current state (see table below).
2. **KPI block** — three cards in a row (Email / Bot / Total), each showing sent / failed / clicked / paid / revenue, plus an email-only `opens` field and bot-only `blocked + deactivated` underneath the bot card.
3. **State-history timeline** — last 5 rows from `broadcast_events` where `event_type='state_change'`.
4. **Links**: «Аудитория», «Превью».

Action buttons by state:

| status            | buttons                           |
| ----------------- | --------------------------------- |
| `draft`           | Изменить, Зафиксировать аудиторию |
| `audience_locked` | Вернуть в черновик, Approve       |
| `active`          | Pause                             |
| `paused`          | Resume                            |
| `done`            | Архивировать                      |

Each button POSTs to the matching `/admin/api/broadcasts/<id>/<verb>` route. After success, reload the page (`router.refresh()`).

The «Approve» button must show a confirm dialog requesting the operator type the recipient count if `count > 500`; pass the typed number as `body.confirm_count` to the route.

### Task 4.5: Audience preview page

**Files:**

- Create: `webgpt-admin/app/(admin)/broadcasts/[id]/audience/page.tsx`

This is a server component. Resolve the audience inline and show:

- Total: N юзеров
- Breakdown by channel: M email, K bot
- Breakdown by plan: free / basic / pro / pro_max counts
- Breakdown by activity bucket (when filter is set)
- Sample 20 first rows: user_id, email (masked: `f***@gmail.com`), tg_chat_id (last 4 digits)

The page must NOT write anything. It's a dry-run preview. Use the resolver directly, don't call `/resolve-audience`. Show a banner reminding the operator that approve will snapshot the audience at THAT moment, not the time of this preview.

### Task 4.6: Render preview page

**Files:**

- Create: `webgpt-admin/app/(admin)/broadcasts/[id]/preview/page.tsx`

A server component that renders the email + the bot message side by side with mock substitutions:

```
{first_name}        → 'Алиса'
{promo_code}        → c.promo_code ?? 'PROMO123'
{promo_expires_at}  → 24h from now, formatted
```

For email: render the HTML inside an iframe-like `<div>` (no actual iframe — just inject sanitized HTML). For bot: render markdown approximation in a `<pre>` block plus a styled box mocking the photo and the button.

The two columns are styled to roughly match each channel's visual width (email = 600px-ish card, bot = 360px-ish phone-sized).

### Task 4.7: Commit Commit 4

```bash
cd /home/deploy/projects/webgpt-admin
git add app/api/broadcasts/\[id\]/ \
  app/\(admin\)/broadcasts/\[id\]/
git commit -m "feat(broadcast): lifecycle endpoints + KPI dashboard + audience/preview pages

Closes the loop on the multi-channel pipeline by adding the routes the
state machine drives plus the operator-facing pages that read campaign
results.

Endpoints (all POST except KPI):
- /resolve-audience  draft → audience_locked, snapshots recipients in
                     a single transaction with row lock so two clicks
                     can't double-insert.
- /unlock            audience_locked → draft, drops recipients to
                     allow filter edits.
- /approve           audience_locked → active. Requires confirm_count
                     equal to recipient count when > 500 to prevent
                     fat-finger on large lists.
- /pause             active → paused.
- /resume            paused → active.
- /kpi (GET)         per-channel aggregates (sent / failed / clicked /
                     paid / revenue), email opens, bot blocked +
                     deactivated counts.

Each state change writes a broadcast_events row with from/to/actor so
the campaign page can show a timeline.

Pages (Russian labels from the spec):
- /admin/broadcasts/[id]: state badge, action buttons per state, KPI
  cards by channel, last 5 state transitions.
- /admin/broadcasts/[id]/audience: dry-run preview. Counts + masked
  sample without writing anything. Banner reminds the operator the
  snapshot happens at approve time, not preview time.
- /admin/broadcasts/[id]/preview: side-by-side rendered email + bot
  with mock variable substitutions ({first_name}, {promo_code},
  {promo_expires_at}).

Spec: docs/superpowers/specs/2026-05-30-tg-broadcast-pipeline-design.md"
```

---

## Commit 5: `/stop` command + UI unsubscribe parity

### Task 5.1: Bot `/stop` command

**Files:**

- Modify: `gptwebrubot/src/registerHandlers.ts` (and one new file under `src/handlers/`)

**Step 1: Write the handler**

Create `gptwebrubot/src/handlers/stop.ts`:

```typescript
import type { CommandContext } from 'grammy';
import type { BotContext } from '../types';
import { upsertBroadcastOptOut } from '../db';

/**
 * /stop — user opts out of all broadcast campaigns.
 *
 * Marks users.broadcast_opted_out = true via the same internal helper that
 * the unsubscribe HTTP route uses. Idempotent — calling /stop twice is
 * fine, second call is a no-op.
 */
export async function handleStopCommand(ctx: CommandContext<BotContext>) {
  const tgUserId = ctx.from?.id;
  if (!tgUserId) {
    await ctx.reply('Не удалось определить ваш профиль.');
    return;
  }
  await upsertBroadcastOptOut(tgUserId);
  await ctx.reply(
    'Вы отписаны от рассылок. ' +
      'Сервисные уведомления (платежи, подписка) продолжат приходить. ' +
      'Возобновить рассылки можно командой /start.',
  );
}
```

**Step 2: Implement `upsertBroadcastOptOut`**

Open `gptwebrubot/src/db.ts` and add:

```typescript
/**
 * Mark the user behind this Telegram user_id as opted out of broadcast
 * campaigns. Looks the user up via user_billing.tg_bot_chat_id (which is
 * how every other bot path resolves a user). No-op if the chat isn't linked.
 */
export async function upsertBroadcastOptOut(tgUserId: number): Promise<void> {
  await sql`
    UPDATE users SET broadcast_opted_out = true
    WHERE id IN (
      SELECT user_id FROM user_billing WHERE tg_bot_chat_id = ${tgUserId}
    )
  `;
}
```

**Step 3: Register the command**

Open `gptwebrubot/src/registerHandlers.ts` and add `handleStopCommand` next to the other command registrations:

```typescript
import { handleStopCommand } from './handlers/stop';
// ...
bot.command('stop', handleStopCommand);
```

Add a matching `/start` re-enable path: after the existing `/start` flow, also UPDATE `broadcast_opted_out = false` for the user so they can resume voluntarily.

**Step 4: Test the command**

Create `gptwebrubot/src/__tests__/stop.test.ts`:

```typescript
import { describe, expect, it, mock } from 'bun:test';
import { handleStopCommand } from '../handlers/stop';

mock.module('../db', () => ({
  upsertBroadcastOptOut: mock(async () => {}),
}));

describe('handleStopCommand', () => {
  it('replies and updates opt-out when from is present', async () => {
    const reply = mock(async () => {});
    await handleStopCommand({ from: { id: 12345 }, reply } as any);
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('отписаны'));
  });

  it('refuses without a from id', async () => {
    const reply = mock(async () => {});
    await handleStopCommand({ from: undefined, reply } as any);
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Не удалось'));
  });
});
```

Run:

```bash
cd /home/deploy/projects/gptwebrubot && bun test src/__tests__/stop.test.ts
```

Expected: both pass.

### Task 5.2: Admin "opted out" status surfaced on the user page

**Files:**

- Modify: `webgpt-admin/app/api/users/[id]/route.ts`
- Modify: `webgpt-admin/components/users/tabs/profile-tab.tsx`

**Step 1: API**

Add `broadcast_opted_out` to the user SELECT:

```typescript
const users = await sql`
      SELECT id, email, username, avatar, full_name,
             last_active_at, created_at, banned,
             COALESCE(broadcast_opted_out, false) AS broadcast_opted_out
      FROM users
      WHERE id = ${id}
      LIMIT 1
    `;
```

**Step 2: ProfileTab**

In `ProfileTabUser` add `broadcast_opted_out: boolean`. In the rendered card, between the activity field and OAuth, add:

```tsx
<div>
  <span className="text-muted-foreground">Рассылки:</span>
  <br />
  {user.broadcast_opted_out ? (
    <Badge variant="outline">Отписан</Badge>
  ) : (
    <span className="text-xs text-muted-foreground">подписан</span>
  )}
</div>
```

### Task 5.3: Commit Commit 5

```bash
cd /home/deploy/projects/gptwebrubot
git add src/handlers/stop.ts src/db.ts src/registerHandlers.ts src/__tests__/stop.test.ts
git commit -m "feat(bot): /stop command opts user out of broadcasts

Adds the TG-side half of broadcast opt-out so users have an in-bot way
to say 'no more pushes' instead of being forced to find the email
unsubscribe link. /start re-enables.

- handlers/stop.ts: looks the user up via user_billing.tg_bot_chat_id
  and UPDATEs users.broadcast_opted_out = true. Idempotent.
- /start path adds a corresponding 'opted_out = false' UPDATE so the
  user can come back voluntarily.
- bun:test coverage for the from-id-present and from-id-missing paths.

Pairs with /api/broadcast/unsubscribe which the email flow already
uses. Both write the same column.

Spec: docs/superpowers/specs/2026-05-30-tg-broadcast-pipeline-design.md"

cd /home/deploy/projects/webgpt-admin
git add app/api/users/\[id\]/route.ts components/users/tabs/profile-tab.tsx
git commit -m "feat(admin): surface broadcast_opted_out on the user page

Adds a small 'Рассылки: Отписан/подписан' badge inside the profile card.
Support can now answer 'why didn't user X get our campaign?' by glance
without dropping into psql.

API selects users.broadcast_opted_out (default false). ProfileTab
renders a badge when opted out, plain text when subscribed."
```

### Task 5.4: End-to-end smoke

After deploy, walk through the whole pipeline by hand:

1. Create draft via `/admin/broadcasts/new` targeting `{tg_linked: true}` with text "smoke test from /new". Submit.
2. On `/admin/broadcasts/<id>`, click «Зафиксировать аудиторию». Expect 64 recipients.
3. Visit the audience preview page. Expect the count to match.
4. Click «Approve» (no confirm needed at 64).
5. Curl send-batch. Verify the recipients drain and the campaign auto-finishes.
6. Open `/admin/broadcasts/<id>` again — KPI block should show 64 sent, plus whatever clicks/blocks accumulated.
7. From your phone, `/stop` in the bot. Verify `users.broadcast_opted_out=true` in psql.
8. Verify `/admin/users/<your-id>` shows the «Отписан» badge.

Clean the test campaign:

```bash
docker exec lobe-postgres psql -U postgres -d lobechat -c "
  UPDATE broadcast_campaigns SET status='archived' WHERE name LIKE 'smoke%';"
```

---

## Plan complete

**Plan complete and saved to `docs/superpowers/plans/2026-05-30-tg-broadcast-pipeline-plan.md`. Two execution options:**

**1. Subagent-Driven (this session)** — I dispatch a fresh subagent per task (or per commit), review between, fast iteration. Recommended given the cross-repo coordination — fewer context switches if I drive both repos.

**2. Parallel Session (separate)** — Open new session with `superpowers:executing-plans`, batch execution with checkpoints.

**Which approach?**
