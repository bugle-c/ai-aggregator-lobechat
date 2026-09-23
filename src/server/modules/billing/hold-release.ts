import { and, eq, isNull } from 'drizzle-orm';

import { creditHolds } from '@/database/schemas';

/**
 * Release a credit hold exactly once.
 *
 * `UPDATE … WHERE id = $1 AND released_at IS NULL RETURNING id` — the row
 * comes back only for the caller that actually flipped it. Every refund /
 * reconcile must be gated on this: on 2026-09-23 the poll cron and the
 * still-running async procedure both finished the same router video task
 * three seconds apart and the user was refunded twice (counter went to
 * −785). Two callers, one hold, one release.
 */
export async function releaseHoldIfActive(tx: any, holdId: string): Promise<boolean> {
  const rows = await tx
    .update(creditHolds)
    .set({ releasedAt: new Date() })
    .where(and(eq(creditHolds.id, holdId), isNull(creditHolds.releasedAt)))
    .returning({ id: creditHolds.id });
  return Array.isArray(rows) && rows.length > 0;
}
