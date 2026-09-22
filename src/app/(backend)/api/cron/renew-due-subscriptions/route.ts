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
 *      payment_method_id IS NOT NULL, cancelled_at IS NULL and
 *      subscription_expires_at falls in the
 *      −RENEW_LEAD_DAYS…+DUNNING_TAIL_DAYS window. plan_id is NOT
 *      filtered: expireSubscriptions downgrades a lapsed-but-still-dunning
 *      row to the free plan while keeping auto_renew and the expiry, so the
 *      post-expiry retries can keep running.
 *      Then, per row, `canAutoChargeStoredMethod` is the ФЗ-376 gate: no
 *      refusal, a real token, and a channel the mandatory T-3 pre-charge
 *      notice could actually have reached.
 *   2. Resolve the tier and the price from the user's last SUCCEEDED
 *      subscription payment (plan_id + amount_rub). The amount is the price
 *      lock — an admin editing the tariff must not re-price an existing
 *      subscriber mid-subscription (offer §5.4).
 *   3. Create a billing_payments row (status='pending'), then call
 *      createYookassaPayment with payment_method_id (server-initiated
 *      charge — no redirect).
 *   4. YooKassa webhook fires payment.succeeded → fulfillPayment() runs
 *      the normal renewal flow: restores plan_id, bumps
 *      subscription_expires_at +30d (from now for a late dunning success),
 *      writes a `created` subscription_event, sends confirmation email.
 *   5. If the charge fails (insufficient funds / card expired), auto_renew
 *      stays on for the next dunning tick and notifyRenewalFailed tells the
 *      user to update the card (throttled).
 *
 * Auth: shared CRON_SECRET. Triggered by the host-side
 * /etc/systemd/system/subscription-renew.timer.
 *
 * Idempotency: the Idempotence-Key header is derived from
 * `${user_id}:${expires_iso_date}:${today_iso_date}` — stable enough that
 * two overlapping cron ticks collapse into one charge, granular enough that
 * tomorrow's dunning retry is a real new attempt instead of a replay of
 * today's decline.
 */
import crypto from 'node:crypto';

import { and, eq, gte, isNotNull, isNull, lte, sql } from 'drizzle-orm';

import { billingPayments, userBilling, users } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { canAutoChargeStoredMethod } from '@/server/modules/billing/recurringRefusal';
import {
  fetchLastSubscriptionPayment,
  resolveRenewalAmount,
  resolveRenewalPlanId,
} from '@/server/modules/billing/renewalAmount';
import { notifyRenewalFailed } from '@/server/modules/lifecycle/notifyRenewalFailed';
import { fetchPlanById } from '@/server/services/billing/plans-source';

// Dunning schedule — when/how often we retry the off-session card charge.
// Start RENEW_LEAD_DAYS BEFORE expiry, then keep retrying AFTER expiry:
// daily for the first DAILY_PHASE_DAYS (catches payday/top-up), then weekly
// out to DUNNING_TAIL_DAYS. Access still lapses at expiry (plan_id → 1) —
// this governs only the charge attempts. The per-row cooldown below is the
// primary double-charge guard; the Idempotence-Key is the backstop.
const RENEW_LEAD_DAYS = 2; // begin charging 2 days before expiry
const DUNNING_TAIL_DAYS = 50; // keep retrying up to 50 days after expiry
const DAILY_PHASE_DAYS = 3; // daily until +3d past expiry, weekly afterwards
const DAILY_COOLDOWN_MS = 20 * 3_600_000; // ≈ once per day in the daily phase
const WEEKLY_COOLDOWN_MS = 7 * 86_400_000; // once per week in the tail phase
const CYCLE_MS = 28 * 86_400_000; // never re-charge after a success this cycle

const FREE_PLAN_ID = 1;

interface RenewResult {
  error?: string;
  notified?: boolean;
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

  // NB: rows on the free plan are deliberately NOT excluded. expireSubscriptions
  // downgrades plan_id → 1 the morning after expiry while KEEPING auto_renew and
  // subscription_expires_at for anyone with a card on file, precisely so the
  // post-expiry dunning tail below can still fire. The plan to re-charge for
  // those rows comes from their last succeeded subscription payment.
  const due = await db
    .select({
      userId: userBilling.userId,
      planId: userBilling.planId,
      autoRenew: userBilling.autoRenew,
      cancelledAt: userBilling.cancelledAt,
      paymentMethodId: userBilling.paymentMethodId,
      expiresAt: userBilling.subscriptionExpiresAt,
      email: users.email,
      tgBotChatId: userBilling.tgBotChatId,
    })
    .from(userBilling)
    .leftJoin(users, eq(users.id, userBilling.userId))
    .where(
      and(
        eq(userBilling.autoRenew, true),
        isNotNull(userBilling.paymentMethodId),
        // ФЗ 376 / ст. 16.1 ЗПП — the payment details must not be USED after
        // a refusal. cancelSubscription already nulls payment_method_id, so
        // this is belt-and-braces against any path that leaves a token on a
        // cancelled row (a manual DB fix, a future partial-cancel flow).
        isNull(userBilling.cancelledAt),
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

    // ФЗ 376 gate, per row. The SQL above is the coarse filter; this is the
    // single tested predicate that decides whether the stored card may be
    // used at all — refusal, missing token, and "no channel the mandatory
    // T-3 pre-charge notice could reach" all block the charge here.
    if (!canAutoChargeStoredMethod(row)) {
      results.push({
        userId: row.userId,
        planId: row.planId,
        outcome: 'skipped',
        error: 'recurring charge not permitted (FZ-376 gate)',
      });
      continue;
    }

    // What the user last actually paid for a subscription. Two jobs:
    //   1. plan resolution for dunning rows already downgraded to free —
    //      user_billing.plan_id no longer says which tier to restore;
    //   2. PRICE LOCK — charge what they agreed to, not today's list price.
    //      Reading ai_aggregator.plans.price_rub meant an admin editing a
    //      tariff silently re-priced every existing subscriber on their next
    //      charge, which offer §5.4 forbids.
    const lastPaid = await fetchLastSubscriptionPayment(db, row.userId);

    const targetPlanId = resolveRenewalPlanId(row.planId, lastPaid, FREE_PLAN_ID);
    if (!targetPlanId) {
      results.push({
        userId: row.userId,
        planId: row.planId,
        outcome: 'skipped',
        error: 'no prior paid subscription to renew',
      });
      continue;
    }

    const plan = await fetchPlanById(targetPlanId);
    if (!plan || plan.priceRub <= 0) {
      results.push({
        userId: row.userId,
        planId: targetPlanId,
        outcome: 'skipped',
        error: 'plan not found or free',
      });
      continue;
    }

    const amountRub = resolveRenewalAmount(lastPaid, targetPlanId, plan.priceRub);

    // Cooldown guard — the primary anti-double-charge mechanism (the
    // Idempotence-Key below only covers same-day repeats).
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
        planId: targetPlanId,
        outcome: 'skipped',
        error: 'recent auto_renew attempt (dedup/cooldown)',
      });
      continue;
    }

    // Pending row — webhook fulfillPayment() flips it to succeeded.
    // planId is the resolved target (fulfillPayment restores exactly this
    // plan), amountRub the locked price.
    let paymentRowId = '';
    try {
      const [inserted] = await db
        .insert(billingPayments)
        .values({
          userId: row.userId,
          amountRub,
          type: 'subscription',
          status: 'pending',
          planId: targetPlanId,
          metadata: { kind: 'auto_renew' } as any,
        })
        .returning({ id: billingPayments.id });
      paymentRowId = inserted.id;
    } catch (err) {
      results.push({
        userId: row.userId,
        planId: targetPlanId,
        outcome: 'failed',
        error: `insert pending row: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    try {
      // Scope: one user, one renewal cycle, one CALENDAR DAY. The cycle part
      // is what makes two overlapping cron ticks collapse into a single
      // charge instead of taking the money twice; the day part is what lets
      // tomorrow's dunning retry be a real new attempt rather than YooKassa
      // replaying today's decline. Sent as the Idempotence-Key header — it
      // used to be computed, stored in metadata and then thrown away while
      // the SDK call generated a random UUID, i.e. no protection at all.
      const idempotencyHint = crypto
        .createHash('sha1')
        .update(
          `${row.userId}:${row.expiresAt.toISOString().slice(0, 10)}:${now.toISOString().slice(0, 10)}`,
        )
        .digest('hex')
        .slice(0, 32);

      const result = await createYookassaPayment({
        amountRub,
        description: `Авто-продление подписки ${plan.name} — WebGPT`,
        idempotencyKey: idempotencyHint,
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
        planId: targetPlanId,
        outcome: 'charged',
        yookassaStatus: result.status,
      });
    } catch (err) {
      // Charge failed — mark our pending row failed but DON'T disable
      // auto_renew. The cron retries tomorrow (still inside the window
      // until expiry).
      await db
        .update(billingPayments)
        .set({ status: 'failed' })
        .where(eq(billingPayments.id, paymentRowId));

      // Tell the user. This used to be a silent failure: the row was marked
      // `failed` and nothing else happened here, while payment-recovery-notify
      // picked the row up and sent «вы не закончили оплату» — wrong, the user
      // started nothing. That flow now skips kind='auto_renew' rows and this
      // branch owns the messaging.
      const notified = await notifyRenewalFailed(db, {
        amountRub,
        email: row.email,
        paymentRowId,
        planName: plan.name,
        tgBotChatId: row.tgBotChatId,
        userId: row.userId,
      });

      results.push({
        userId: row.userId,
        planId: targetPlanId,
        outcome: 'failed',
        error: err instanceof Error ? err.message : String(err),
        notified,
      });
      console.error(
        `[renew] failed user=${row.userId} plan=${targetPlanId}:`,
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
