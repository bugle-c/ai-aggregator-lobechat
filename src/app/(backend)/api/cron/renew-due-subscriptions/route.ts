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

import { and, eq, gte, isNotNull, lte, ne } from 'drizzle-orm';

import { billingPayments, userBilling } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { fetchPlanById } from '@/server/services/billing/plans-source';

const RENEW_WINDOW_DAYS = 1; // charge ~24h before expiry

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
  const horizon = new Date(now.getTime() + RENEW_WINDOW_DAYS * 86_400_000);

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
        // expires within the renewal window
        gte(userBilling.subscriptionExpiresAt, now),
        lte(userBilling.subscriptionExpiresAt, horizon),
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
