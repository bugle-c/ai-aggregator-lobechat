import { and, eq, gte, sql } from 'drizzle-orm';

import { messages } from '@/database/schemas/message';
import { type LobeChatDatabase } from '@/database/type';

/**
 * EXP-003 (2026-09-13): the free plan is a per-day message allowance, not a
 * monthly credit budget. L30 showed 44/57 activated users burned the whole
 * 30-credit month in session 1 and 5.8 % came back on day 2; the competitor
 * sells «10 запросов в день» as its free hook. See
 * GPTWEB/tasks/2026-09-13-exp003-daily-quota-plan.md.
 *
 * Counting unit = **user messages** (`messages.role='user'`) per Moscow day.
 * Not `usage_logs`: that table also gets a `kind='chat'` row for every
 * topic auto-title (`fetchPresetTaskResult`) and every tool-call follow-up
 * step, which would silently eat 1–2 of the 5. Credits stay the accounting
 * unit for economics; only the *gate* changes. `plans.token_limit` for free
 * (150) remains a monthly safety cap so a runaway day cannot cost more.
 */
export const FREE_DAILY_MESSAGE_QUOTA = 5;

export const FREE_PLAN_SLUG = 'free';

/**
 * Request header the client sets on system/preset completions (topic title,
 * agent meta …). Those must neither count toward nor be blocked by the daily
 * quota — a title request dying in a paywall error is invisible to the user.
 * They are still charged credits as before.
 */
export const WEBGPT_TASK_HEADER = 'x-webgpt-task';
export const WEBGPT_TASK_PRESET = 'preset';

/** Europe/Moscow is a fixed UTC+3 — no DST since 2014, so no tz database needed. */
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 00:00 Europe/Moscow of the Moscow calendar day containing `now`, as a UTC instant. */
export function moscowDayStart(now: Date = new Date()): Date {
  const shifted = now.getTime() + MSK_OFFSET_MS;
  return new Date(Math.floor(shifted / DAY_MS) * DAY_MS - MSK_OFFSET_MS);
}

/** Next 00:00 Europe/Moscow after `now` — when the daily quota refills. */
export function nextMoscowDayStart(now: Date = new Date()): Date {
  return new Date(moscowDayStart(now).getTime() + DAY_MS);
}

/**
 * User messages persisted since `since`. Both the web client
 * (`aiChat.sendMessageInServer` runs before the streaming fetch) and the
 * bot (`insertMessage` before `streamChat`) persist the user message BEFORE
 * the chat route's gate runs, so at gate time the count already includes
 * the message being answered — `decideUsageLimit` accounts for that.
 * Tool-call follow-up steps and preset tasks add no user row → count once.
 *
 * Plan on live PG: Index Scan on `messages_created_at_idx` + filter
 * (0.06 ms, 4 buffers) — no seq scan, no migration needed.
 */
export async function countUserMessagesSince(
  db: LobeChatDatabase,
  userId: string,
  since: Date,
): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messages)
    .where(
      and(eq(messages.userId, userId), eq(messages.role, 'user'), gte(messages.createdAt, since)),
    );
  return Number(rows[0]?.count ?? 0);
}
