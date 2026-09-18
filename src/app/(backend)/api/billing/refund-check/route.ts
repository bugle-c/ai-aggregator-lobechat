import { desc, eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { billingPayments, userBilling } from '@/database/schemas';
import { getServerDB } from '@/database/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/billing/refund-check
 *
 * Called by the bot's /support refund branch. Verifies whether a user's
 * refund claim corresponds to a real payment BEFORE the claim reaches the
 * admin chat. Two sources:
 *
 *   1. billing_payments — the source of truth for OUR payments. Ownership
 *      is guaranteed: rows are selected by the user resolved from
 *      `user_billing.tg_bot_chat_id`.
 *   2. YooKassa listing (shop creds from env) — catches the "payment
 *      succeeded at the provider but our webhook was lost" case. A YooKassa
 *      payment is attributed to this user only when it is unbound in our DB
 *      AND carries no identifying metadata pointing at another user.
 *
 * Verdicts:
 *   no_user   — no user_billing row for this tg id (never used the bot/billing)
 *   not_found — no matching payment anywhere → bot auto-answers, admin NOT pinged
 *   found     — at least one candidate → bot forwards the card to SUPPORT_CHAT_ID
 *
 * Auth: X-Internal-Token (same shared secret as the other bot↔aggregator routes).
 */

interface Body {
  amount_rub?: number;
  /** ISO date YYYY-MM-DD — the day the user claims the charge happened */
  date?: string | null;
  tg_user_id: number;
}

interface YkPayment {
  amount: { value: string };
  created_at: string;
  description?: string;
  id: string;
  metadata?: Record<string, string>;
  status: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function POST(req: Request) {
  const token = req.headers.get('x-internal-token');
  if (!process.env.BOT_INTERNAL_TOKEN || token !== process.env.BOT_INTERNAL_TOKEN) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400 });
  }
  if (!body.tg_user_id || typeof body.tg_user_id !== 'number') {
    return NextResponse.json({ ok: false, error: 'bad_tg_id' }, { status: 400 });
  }

  const db = await getServerDB();

  const ub = await db
    .select({ userId: userBilling.userId, planId: userBilling.planId })
    .from(userBilling)
    .where(eq(userBilling.tgBotChatId, String(body.tg_user_id)))
    .limit(1);

  if (ub.length === 0) {
    return NextResponse.json({ ok: true, verdict: 'no_user', our_payments: [] });
  }
  const userId = ub[0].userId;

  // 1) Our payments (all-time, newest first — the user may misremember the date).
  const our = await db
    .select({
      amountRub: billingPayments.amountRub,
      createdAt: billingPayments.createdAt,
      description: sql<string>`coalesce(${billingPayments.metadata}->>'description', '')`,
      status: billingPayments.status,
      yookassaPaymentId: billingPayments.yookassaPaymentId,
    })
    .from(billingPayments)
    .where(eq(billingPayments.userId, userId))
    .orderBy(desc(billingPayments.createdAt))
    .limit(50);

  const amount = body.amount_rub;
  const ourRows = our.filter((p) => (amount != null ? p.amountRub === amount : true));

  // 2) YooKassa: only when a date window is meaningful. Unbound (lost-webhook)
  //    candidates are attributed to this user only when their metadata does
  //    not name a different user.
  const ykMatches: Array<{
    id: string;
    status: string;
    amount_rub: number;
    description: string;
    created_at: string;
  }> = [];
  const shopId = process.env.YOOKASSA_SHOP_ID;
  const secret = process.env.YOOKASSA_SECRET_KEY;
  if (shopId && secret) {
    const now = Date.now();
    let gte: Date;
    let lte: Date;
    const parsedDate = body.date ? new Date(`${body.date}T00:00:00Z`) : null;
    if (parsedDate && !Number.isNaN(parsedDate.getTime())) {
      gte = new Date(parsedDate.getTime() - 3 * DAY_MS);
      lte = new Date(parsedDate.getTime() + 3 * DAY_MS);
    } else {
      gte = new Date(now - 45 * DAY_MS);
      lte = new Date(now);
    }
    lte = lte.getTime() > now ? new Date(now) : lte;

    try {
      const auth = Buffer.from(`${shopId}:${secret}`).toString('base64');
      const url =
        `https://api.yookassa.ru/v3/payments?limit=100` +
        `&created_at_gte=${encodeURIComponent(gte.toISOString())}` +
        `&created_at_lte=${encodeURIComponent(lte.toISOString())}`;
      const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
      if (res.ok) {
        const json = (await res.json()) as { items?: YkPayment[] };
        const items = json.items ?? [];
        // A YooKassa payment bound to ANY billing_payments row is accounted
        // for; only truly unbound rows can be a lost webhook. (Checking only
        // THIS user's rows leaked other users' payments into unmatched —
        // caught in the 2026-09-18 smoke test.)
        const listedIds = items.map((p) => p.id);
        const boundToAny = new Set<string>();
        if (listedIds.length > 0) {
          const boundRows = await db
            .select({ ownerId: billingPayments.userId, ykId: billingPayments.yookassaPaymentId })
            .where(sql`${billingPayments.yookassaPaymentId} = ANY(${listedIds}::text[])`);
          for (const r of boundRows) boundToAny.add(r.ykId);
        }
        const boundIds = new Set(our.map((p) => p.yookassaPaymentId).filter(Boolean) as string[]);
        for (const p of items) {
          const value = Number.parseFloat(p.amount?.value ?? '0');
          if (amount != null && Math.round(value) !== amount) continue;
          if (boundToAny.has(p.id) || boundIds.has(p.id)) continue;
          const meta = p.metadata ?? {};
          const metaUser = meta.user_id ?? meta.userId;
          const metaTg = meta.tg_user_id;
          // Identifying metadata pointing at someone else → not theirs.
          if (metaUser && metaUser !== userId) continue;
          if (metaTg && metaTg !== String(body.tg_user_id)) continue;
          ykMatches.push({
            amount_rub: Math.round(value),
            created_at: p.created_at,
            description: p.description ?? '',
            id: p.id,
            status: p.status,
          });
        }
      } else {
        console.warn('[refund-check] yookassa listing failed:', res.status);
      }
    } catch (err) {
      console.warn('[refund-check] yookassa listing error:', (err as Error).message);
    }
  }

  const found = ourRows.length > 0 || ykMatches.length > 0;
  return NextResponse.json({
    ok: true,
    plan_id: ub[0].planId,
    our_payments: ourRows.map((p) => ({
      amount_rub: p.amountRub,
      created_at: p.createdAt,
      status: p.status,
      yookassa_payment_id: p.yookassaPaymentId,
    })),
    unmatched_yookassa: ykMatches,
    verdict: found ? 'found' : 'not_found',
  });
}
