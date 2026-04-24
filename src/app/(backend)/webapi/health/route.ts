import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getServerDB } from '@/database/core/db-adaptor';

// Do not cache — this must always hit the DB.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /webapi/health
 *
 * Lightweight liveness + DB probe for UptimeRobot / alerting.
 *
 * - 200 `{status:"ok", db:"ok", timestamp}`        — app responsive, DB reachable.
 * - 503 `{status:"degraded", db:"error", ...}`    — app responsive but DB ping failed.
 *
 * Intentionally no auth: must be reachable by external uptime monitors.
 * The probe is a cheap `SELECT 1` — no sensitive data in response.
 */
export const GET = async () => {
  const timestamp = new Date().toISOString();

  try {
    const db = await getServerDB();
    await db.execute(sql`SELECT 1`);

    return NextResponse.json({ db: 'ok', status: 'ok', timestamp }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        db: 'error',
        error: message.slice(0, 200),
        status: 'degraded',
        timestamp,
      },
      { status: 503 },
    );
  }
};
