/**
 * Reconcile-pending-payments cron.
 *
 * Two failure modes leave billing_payments rows pinned at status='pending':
 *
 *   1) We started a payment row but the YooKassa createPayment call
 *      threw (403/network/etc.) before we could write back
 *      `yookassa_payment_id`. The row has no YK reference, so the
 *      webhook will never reach it.
 *
 *   2) We sent the payment to YK successfully but the user closed the
 *      checkout window without paying. YK eventually auto-cancels
 *      (default TTL 7 days for cards). We may or may not receive a
 *      webhook for the canceled state. Without reconciliation the row
 *      stays "pending" forever — finance dashboards count it as a
 *      potential future success, support keeps emailing the user.
 *
 * Two passes, idempotent:
 *
 *   A) Local-fail: rows older than UNSENT_THRESHOLD_MS with no
 *      yookassa_payment_id → mark `failed`. These never reached YK.
 *
 *   B) Reconcile: rows older than STALE_THRESHOLD_MS with a
 *      yookassa_payment_id → GET payment from YK, then:
 *        - succeeded            → fulfillPayment() (webhook missed)
 *        - canceled             → mark `canceled`
 *        - waiting_for_capture  → leave alone (still in flight)
 *        - pending older than HARD_TIMEOUT_MS → mark `canceled` locally
 *
 * Triggered by host cron every 10 min with Bearer CRON_SECRET.
 */
import { and, eq, isNull, lt } from 'drizzle-orm';

import { billingPayments } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { fulfillPayment } from '@/server/modules/billing/fulfill';
import { fetchYookassaPaymentStatus } from '@/server/modules/billing/yookassa';

const UNSENT_THRESHOLD_MS = 5 * 60 * 1000; // 5 min — never reached YK
const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour — start polling YK
const HARD_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — give up

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return new Response('Unauthorized', { status: 401 });
  }

  const db = await getServerDB();
  const summary = { localFailed: 0, fulfilledFromYK: 0, canceledFromYK: 0, timedOut: 0, errors: 0 };

  // PASS A: rows that never reached YK at all.
  const unsent = await db
    .select({ id: billingPayments.id })
    .from(billingPayments)
    .where(
      and(
        eq(billingPayments.status, 'pending'),
        isNull(billingPayments.yookassaPaymentId),
        lt(billingPayments.createdAt, new Date(Date.now() - UNSENT_THRESHOLD_MS)),
      ),
    );

  for (const row of unsent) {
    try {
      await db
        .update(billingPayments)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(billingPayments.id, row.id));
      summary.localFailed++;
    } catch (err) {
      summary.errors++;
      console.error('[reconcile-pending] local-fail update error:', err);
    }
  }

  // PASS B: rows with a YK reference, older than STALE_THRESHOLD_MS.
  // Limit to 50 per run so a backlog doesn't blow the YK rate limit.
  const stale = await db
    .select({
      id: billingPayments.id,
      yookassaPaymentId: billingPayments.yookassaPaymentId,
      createdAt: billingPayments.createdAt,
    })
    .from(billingPayments)
    .where(
      and(
        eq(billingPayments.status, 'pending'),
        lt(billingPayments.createdAt, new Date(Date.now() - STALE_THRESHOLD_MS)),
      ),
    )
    .limit(50);

  for (const row of stale) {
    if (!row.yookassaPaymentId) continue;
    try {
      const yk = await fetchYookassaPaymentStatus(row.yookassaPaymentId);
      const age = Date.now() - row.createdAt.getTime();

      if (!yk) {
        // YK doesn't know this payment. Local-only orphan.
        await db
          .update(billingPayments)
          .set({ status: 'failed', updatedAt: new Date() })
          .where(eq(billingPayments.id, row.id));
        summary.localFailed++;
        continue;
      }

      if (yk.status === 'succeeded') {
        // Webhook missed — fulfill now (idempotent: fulfillPayment is a no-op
        // when status is already succeeded).
        await fulfillPayment(db, row.yookassaPaymentId, {
          savedPaymentMethodId: yk.paymentMethodId,
        });
        summary.fulfilledFromYK++;
      } else if (yk.status === 'canceled') {
        await db
          .update(billingPayments)
          .set({ status: 'canceled', updatedAt: new Date() })
          .where(eq(billingPayments.id, row.id));
        summary.canceledFromYK++;
      } else if (age > HARD_TIMEOUT_MS) {
        // YK still says pending after 7 days — give up locally so the
        // row stops cluttering finance views. YK will eventually
        // auto-cancel on their side.
        await db
          .update(billingPayments)
          .set({ status: 'canceled', updatedAt: new Date() })
          .where(eq(billingPayments.id, row.id));
        summary.timedOut++;
      }
      // else: pending / waiting_for_capture, leave as is and revisit next run.
    } catch (err) {
      summary.errors++;
      console.error('[reconcile-pending] YK fetch error for', row.id, err);
    }
  }

  return Response.json({ ok: true, ...summary });
}
