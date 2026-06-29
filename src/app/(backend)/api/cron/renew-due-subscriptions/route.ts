/**
 * Daily cron: charge the saved card for every paid subscription that's
 * about to expire AND has `auto_renew=true`.
 *
 * Without this endpoint, paid subscriptions silently lapsed at
 * `subscription_expires_at` — there was no recurring-payment loop, every
 * cycle required the user to come back and click "Pay" themselves.
 *
 * Flow:
 *   1. Find user_billing rows where auto_renew=true,
 *      payment_method_id IS NOT NULL, plan_id != 1 (free), and
 *      subscription_expires_at within `RENEW_WINDOW_DAYS` of now.
 *   2. For each, create a billing_payments row (status='pending') for the
 *      same plan and price, then call createYookassaPayment with
 *      payment_method_id (server-initiated charge — no redirect).
 *   3. YooKassa webhook fires payment.succeeded → fulfillPayment() runs
 *      the normal renewal flow: bumps subscription_expires_at +30d,
 *      writes a `created` subscription_event, sends confirmation email.
 *   4. If the YooKassa charge fails (insufficient funds / card expired),
 *      we leave auto_renew alone for one tick (next-day retry) but flag
 *      the row so the user gets an email about the failed renewal.
 *
 * Auth: shared CRON_SECRET. Triggered by the host-side
 * /etc/systemd/system/subscription-renew.timer.
 *
 * Idempotency: the YooKassa SDK requires an Idempotence-Key per request;
 * we generate a stable one from `${user_id}:${expires_iso_date}` so the
 * same renewal cycle never double-charges even if the cron fires twice.
 */
import crypto from 'node:crypto';

import { and, eq, gte, isNotNull, lte, ne, sql } from 'drizzle-orm';

import { billingPayments, userBilling } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { fetchPlanById } from '@/server/services/billing/plans-source';

// Dunning schedule — when/how often we retry the off-session card charge.
// Start RENEW_LEAD_DAYS BEFORE expiry, then keep retrying AFTER expiry:
// daily for the first DAILY_PHASE_DAYS (catches payday/top-up), then weekly
// out to DUNNING_TAIL_DAYS. The subscription itself still lapses at expiry —
// this governs only the charge attempts. createYookassaPayment uses a random
// Idempotence-Key, so the per-row cooldown below is the double-charge guard.
const RENEW_LEAD_DAYS = 2; // begin charging 2 days before expiry
const DUNNING_TAIL_DAYS = 50; // keep retrying up to 50 days after expiry
const DAILY_PHASE_DAYS = 3; // daily until +3d past expiry, weekly afterwards
const DAILY_COOLDOWN_MS = 20 * 3_600_000; // ≈ once per day in the daily phase
const WEEKLY_COOLDOWN_MS = 7 * 86_400_000; // once per week in the tail phase
const CYCLE_MS = 28 * 86_400_000; // never re-charge after a success this cycle

interface RenewResult {
  error?: string;
  outcome: 'charged' | 'skipped' | 'failed';
  planId: number;
  userId: string;
  yookassaStatus?: string;
}

export async function POST(req: Request) {
  const auth = req.headers.get('authorization');
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const db = await getServerDB();
  const now = new Date();
  const leadHorizon = new Date(now.getTime() + RENEW_LEAD_DAYS * 86_400_000);
  const tailFloor = new Date(now.getTime() - DUNNING_TAIL_DAYS * 86_400_000);

  const due = await db
    .select({
      userId: userBilling.userId,
      planId: userBilling.planId,
      paymentMethodId: userBilling.paymentMethodId,
      expiresAt: userBilling.subscriptionExpiresAt,
    })
    .from(userBilling)
    .where(
      and(
        eq(userBilling.autoRenew, true),
        isNotNull(userBilling.paymentMethodId),
        ne(userBilling.planId, 1), // not free
        isNotNull(userBilling.subscriptionExpiresAt),
        // due window: from RENEW_LEAD_DAYS before expiry through the dunning
        // tail (DUNNING_TAIL_DAYS after). Per-row cadence is enforced below.
        gte(userBilling.subscriptionExpiresAt, tailFloor),
        lte(userBilling.subscriptionExpiresAt, leadHorizon),
      ),
    );

  const results: RenewResult[] = [];
  const { createYookassaPayment } = await import('@/server/modules/billing/yookassa');

  for (const row of due) {
    if (!row.paymentMethodId || !row.expiresAt) continue;

    const plan = await fetchPlanById(row.planId);
    if (!plan || plan.priceRub <= 0) {
      results.push({
        userId: row.userId,
        planId: row.planId,
        outcome: 'skipped',
        error: 'plan not found or free',
      });
      continue;
    }

    // Idempotency + cooldown guard. createYookassaPayment uses a RANDOM
    // Idempotence-Key per call, so YooKassa offers no double-charge protection.
    // Skip the user if they already have a pending/succeeded auto_renew THIS
    // cycle (never double-charge / never re-charge after success), OR a prior
    // attempt inside the dynamic cadence window. Cadence: DAILY until
    // DAILY_PHASE_DAYS past expiry (catches a payday top-up), WEEKLY afterwards
    // — fewer, well-spaced retries are kinder to the acquirer than hammering a
    // hard decline. (msPastExpiry is negative before expiry → still daily.)
    const msPastExpiry = now.getTime() - row.expiresAt.getTime();
    const requiredGapMs =
      msPastExpiry <= DAILY_PHASE_DAYS * 86_400_000 ? DAILY_COOLDOWN_MS : WEEKLY_COOLDOWN_MS;
    const cooldown = new Date(now.getTime() - requiredGapMs);
    const cycle = new Date(now.getTime() - CYCLE_MS);
    const blockers = await db
      .select({ id: billingPayments.id })
      .from(billingPayments)
      .where(
        sql`${billingPayments.userId} = ${row.userId}
            AND ${billingPayments.metadata}->>'kind' = 'auto_renew'
            AND (
              (${billingPayments.status} IN ('pending','succeeded') AND ${billingPayments.createdAt} > ${cycle})
              OR ${billingPayments.createdAt} > ${cooldown}
            )`,
      )
      .limit(1);
    if (blockers.length > 0) {
      results.push({
        userId: row.userId,
        planId: row.planId,
        outcome: 'skipped',
        error: 'recent auto_renew attempt (dedup/cooldown)',
      });
      continue;
    }

    // Pending row — webhook fulfillPayment() flips it to succeeded.
    let paymentRowId = '';
    try {
      const [inserted] = await db
        .insert(billingPayments)
        .values({
          userId: row.userId,
          amountRub: plan.priceRub,
          type: 'subscription',
          status: 'pending',
          planId: row.planId,
          metadata: { kind: 'auto_renew' } as any,
        })
        .returning({ id: billingPayments.id });
      paymentRowId = inserted.id;
    } catch (err) {
      results.push({
        userId: row.userId,
        planId: row.planId,
        outcome: 'failed',
        error: `insert pending row: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    try {
      const idempotencyHint = crypto
        .createHash('sha1')
        .update(`${row.userId}:${row.expiresAt.toISOString().slice(0, 10)}`)
        .digest('hex')
        .slice(0, 32);

      const result = await createYookassaPayment({
        amountRub: plan.priceRub,
        description: `Авто-продление подписки ${plan.name} — WebGPT`,
        metadata: {
          payment_id: paymentRowId,
          type: 'subscription',
          kind: 'auto_renew',
          idem_hint: idempotencyHint,
        },
        returnUrl: 'https://ask.gptweb.ru/settings/billing',
        paymentMethodId: row.paymentMethodId,
      });

      // Stash the yookassa id on our row so the webhook can match.
      await db
        .update(billingPayments)
        .set({ yookassaPaymentId: result.paymentId })
        .where(eq(billingPayments.id, paymentRowId));

      results.push({
        userId: row.userId,
        planId: row.planId,
        outcome: 'charged',
        yookassaStatus: result.status,
      });
    } catch (err) {
      // Charge failed — mark our pending row failed but DON'T disable
      // auto_renew. The cron retries tomorrow (still inside the window
      // until expiry). User gets a renewal-failure email separately.
      await db
        .update(billingPayments)
        .set({ status: 'failed' })
        .where(eq(billingPayments.id, paymentRowId));
      results.push({
        userId: row.userId,
        planId: row.planId,
        outcome: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
      console.error(
        `[renew] failed user=${row.userId} plan=${row.planId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return Response.json({
    candidates: due.length,
    results,
    scannedAt: now.toISOString(),
  });
}
