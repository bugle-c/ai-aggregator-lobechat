/**
 * GET /api/cron/expire-bonus-balance
 *
 * Daily cron. Zeros bonus_balance on rows whose bonus_balance_expires_at
 * has passed. Idempotent — re-running has no effect (rows match the
 * filter only while non-zero). Schedule: 03:00 MSK alongside other
 * billing maintenance crons.
 */
import { sql } from 'drizzle-orm';

import { getServerDB } from '@/database/server';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return new Response('Unauthorized', { status: 401 });
  }

  const db = await getServerDB();
  const result = await db.execute(sql`
    UPDATE user_billing
    SET bonus_balance = 0,
        bonus_balance_expires_at = NULL,
        updated_at = NOW()
    WHERE bonus_balance > 0
      AND bonus_balance_expires_at IS NOT NULL
      AND bonus_balance_expires_at < NOW()
    RETURNING user_id
  `);

  return Response.json({ ok: true, expired_count: result.rows.length });
}
