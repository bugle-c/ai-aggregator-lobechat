import { and, eq, gte, sql } from 'drizzle-orm';

import { usageLogs } from '@/database/schemas/analytics';
import { type LobeChatDatabase } from '@/database/type';

/**
 * EXP-003 (2026-09-13): the free plan is a per-day message allowance, not a
 * monthly credit budget. L30 showed 44/57 activated users burned the whole
 * 30-credit month in session 1 and 5.8 % came back on day 2; the competitor
 * sells «10 запросов в день» as its free hook. See
 * GPTWEB/tasks/2026-09-13-exp003-daily-quota-plan.md.
 *
 * Counting unit = user messages that reached the model = `usage_logs` rows
 * with `kind='chat'` (one row per charged completion, written by
 * recordTokenUsage). Credits stay the accounting unit for economics; only the
 * *gate* changes. `plans.token_limit` for free (150) remains a monthly safety
 * cap so a runaway day cannot cost more than before.
 */
export const FREE_DAILY_MESSAGE_QUOTA = 5;

export const FREE_PLAN_SLUG = 'free';

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
 * Chat messages the user has been charged for since `since`.
 * Served by `usage_logs_user_created_idx (user_id, created_at DESC)` —
 * an index range scan, no seq scan (EXPLAIN in the EXP-003 report).
 */
export async function countChatMessagesSince(
  db: LobeChatDatabase,
  userId: string,
  since: Date,
): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(usageLogs)
    .where(
      and(eq(usageLogs.userId, userId), eq(usageLogs.kind, 'chat'), gte(usageLogs.createdAt, since)),
    );
  return Number(rows[0]?.count ?? 0);
}
