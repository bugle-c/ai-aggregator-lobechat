/**
 * GET /api/public/blog-promo
 *
 * Public, unauthenticated endpoint that returns the single promo_codes row
 * flagged `use_in_blog=true` AND `is_active=true` AND not yet expired.
 *
 * Used by the landing/blog CTA on gptweb.ru to render the current
 * promotion (code, bonus credits, duration). DB enforces at most one row
 * with the flag (partial unique index), so we always return zero or one
 * promo — never have to pick between competing rows.
 *
 * Returns 200 with `null` when no promo is active so the landing can hide
 * the CTA cleanly without surfacing a 404 to bots.
 *
 * Cached at the edge for 60s (`s-maxage=60`) — admin toggle propagates
 * within a minute, but blog readers don't hammer the DB on every page view.
 */
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { promoCodes } from '@/database/schemas';
import { getServerDB } from '@/database/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = await getServerDB();

    const rows = await db
      .select({
        code: promoCodes.code,
        durationDays: promoCodes.durationDays,
        expiresAt: promoCodes.expiresAt,
        maxUses: promoCodes.maxUses,
        tokenAmount: promoCodes.tokenAmount,
        type: promoCodes.type,
        usedCount: promoCodes.usedCount,
      })
      .from(promoCodes)
      .where(
        and(
          eq(promoCodes.useInBlog, true),
          eq(promoCodes.isActive, true),
          or(isNull(promoCodes.expiresAt), gt(promoCodes.expiresAt, sql`now()`)),
        ),
      )
      .limit(1);

    const promo = rows[0] ?? null;

    return new NextResponse(JSON.stringify({ promo }), {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
        'Content-Type': 'application/json',
      },
    });
  } catch (err) {
    console.error('[public/blog-promo] query failed:', err);
    // Fail-open with null — landing handles it gracefully.
    return NextResponse.json({ promo: null }, { status: 200 });
  }
}
