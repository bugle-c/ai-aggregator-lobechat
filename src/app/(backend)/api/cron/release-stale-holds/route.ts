/**
 * Daily cron — release credit_holds rows that never got resolved.
 *
 * Media reservations preserve their ordinary/refund funding allocations.
 * Orphaned holds older than 24 hours are settled at zero through the same
 * guarded service as normal completion, restoring only eligible sources.
 *
 * Auth: shared CRON_SECRET. Triggered by /etc/systemd/system/release-stale-holds.timer.
 */
import { and, isNull, lt } from 'drizzle-orm';

import { creditHolds } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { BillingService } from '@/server/services/billing';

interface ReleaseResult {
  amount: number;
  error?: string;
  holdId: string;
  outcome: 'released' | 'already-settled' | 'failed';
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
      const result = await db.transaction(async (tx) =>
        new BillingService(tx, row.userId).settleCreditHold(row.id, 0, tx),
      );

      results.push({
        holdId: row.id,
        userId: row.userId,
        amount: row.amount,
        outcome: result.settled ? 'released' : 'already-settled',
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
