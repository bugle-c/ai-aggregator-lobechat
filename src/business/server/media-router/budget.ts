/**
 * Daily budget for router-served videos.
 *
 * The Veo pool is a finite, shared resource (≈ 70 text→video renders a month
 * for the whole pool, also used by content-farm), so the aggregator caps how
 * many clips it sends there per Moscow day. Source of truth is `usage_logs`
 * (`provider='llm-router'`, `kind='video'`, today) plus an in-memory count of
 * renders currently in flight — survives restarts without extra tables.
 */
import { and, count, eq, gte } from 'drizzle-orm';

import { usageLogs } from '@/database/schemas/analytics';
import { type LobeChatDatabase } from '@/database/type';
import { moscowDayStart } from '@/server/modules/billing/daily-quota';

import { getMediaRouterConfig, ROUTER_PROVIDER_ID } from './config';

let inFlight = 0;

export async function countRouterVideosToday(
  db: LobeChatDatabase,
  now = new Date(),
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(usageLogs)
    .where(
      and(
        eq(usageLogs.provider, ROUTER_PROVIDER_ID),
        eq(usageLogs.kind, 'video'),
        gte(usageLogs.createdAt, moscowDayStart(now)),
      ),
    );
  return Number(row?.n ?? 0);
}

/**
 * Reserve one slot of today's budget. Returns false when the budget is spent;
 * the caller then goes to WaveSpeed as usual. Release with `releaseVideoSlot`
 * when the router attempt fails (a successful render is counted by its
 * usage_logs row from then on).
 */
export async function tryReserveVideoSlot(db: LobeChatDatabase): Promise<boolean> {
  const { videoDailyBudget } = getMediaRouterConfig();
  if (videoDailyBudget <= 0) return false;
  const used = await countRouterVideosToday(db);
  if (used + inFlight >= videoDailyBudget) return false;
  inFlight += 1;
  return true;
}

export function releaseVideoSlot(): void {
  inFlight = Math.max(0, inFlight - 1);
}

/** Test helper. */
export function resetVideoBudget(): void {
  inFlight = 0;
}
