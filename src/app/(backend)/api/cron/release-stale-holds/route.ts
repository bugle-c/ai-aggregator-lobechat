/**
 * Daily cron — release credit_holds rows that never got resolved.
 *
 * `chargeBeforeGenerate` (image/video) atomically reserves credits via a
 * `credit_holds` row + `tokensUsedMonth` bump. The matching
 * `chargeAfterGenerate` resolves it on success (settles cost) or error
 * (refunds the reservation). If the worker process dies between those
 * two calls — container OOM, hard crash, kill -9 — the hold becomes
 * orphaned: `released_at IS NULL` and the user's reserved credits are
 * never returned. The audit found 1 such row already.
 *
 * Strategy: every hold older than 24 hours and still un-released is
 * almost certainly orphaned (real image/video gens finish in under 10
 * minutes). Refund by `incrementTokensUsed(-amount)` and stamp
 * `released_at`. Run daily.
 *
 * Auth: shared CRON_SECRET. Triggered by /etc/systemd/system/release-stale-holds.timer.
 */
import { and, eq, isNull, lt, sql } from 'drizzle-orm';

import { creditHolds, userBilling } from '@/database/schemas';
import { getServerDB } from '@/database/server';

interface ReleaseResult {
  amount: number;
  error?: string;
  holdId: string;
  outcome: 'released' | 'failed';
  userId: string;
}

const STALE_HOURS = 24;

export async function POST(req: Request) {
  const auth = req.headers.get('authorization');
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const db = await getServerDB();
  const now = new Date();
  const cutoff = new Date(now.getTime() - STALE_HOURS * 3600_000);

  const stale = await db
    .select({
      id: creditHolds.id,
      userId: creditHolds.userId,
      amount: creditHolds.amount,
      createdAt: creditHolds.createdAt,
    })
    .from(creditHolds)
    .where(and(isNull(creditHolds.releasedAt), lt(creditHolds.createdAt, cutoff)));

  const results: ReleaseResult[] = [];

  for (const row of stale) {
    try {
      // Refund + mark released atomically.
      await db.transaction(async (tx) => {
        await tx
          .update(userBilling)
          .set({
            tokensUsedMonth: sql`GREATEST(0, ${userBilling.tokensUsedMonth} - ${row.amount})`,
            updatedAt: now,
          })
          .where(eq(userBilling.userId, row.userId));

        await tx.update(creditHolds).set({ releasedAt: now }).where(eq(creditHolds.id, row.id));
      });

      results.push({
        holdId: row.id,
        userId: row.userId,
        amount: row.amount,
        outcome: 'released',
      });
      console.info(
        `[cron/release-stale-holds] released user=${row.userId} amount=${row.amount} created=${row.createdAt.toISOString()}`,
      );
    } catch (err) {
      results.push({
        holdId: row.id,
        userId: row.userId,
        amount: row.amount,
        outcome: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
      console.error(`[cron/release-stale-holds] failed user=${row.userId} hold=${row.id}:`, err);
    }
  }

  return Response.json({
    candidates: stale.length,
    cutoff: cutoff.toISOString(),
    results,
    scannedAt: now.toISOString(),
  });
}
