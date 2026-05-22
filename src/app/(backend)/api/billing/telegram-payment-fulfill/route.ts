import crypto from 'node:crypto';

import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { billingPayments } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { authEnv } from '@/envs/auth';
import { fulfillPayment } from '@/server/modules/billing/fulfill';
import { verifyRecoveryToken } from '@/server/modules/billing/recovery-token';

export const dynamic = 'force-dynamic';

interface Body {
  currency: string; // 'RUB'
  invoice_payload: string;
  provider_payment_charge_id: string;
  telegram_payment_charge_id: string;
  tg_user_id: number;
  total_amount: number; // KOPECKS
}

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

  const secret = authEnv.AUTH_SECRET || process.env.AUTH_SECRET;
  if (!secret) {
    console.error('[tg-payment-fulfill] AUTH_SECRET missing');
    return NextResponse.json({ ok: false, error: 'server_misconfigured' }, { status: 500 });
  }

  const verified = verifyRecoveryToken(body.invoice_payload, secret);
  if (!verified) {
    return NextResponse.json({ ok: false, error: 'invalid_payload' }, { status: 400 });
  }

  const db = await getServerDB();
  const original = await db
    .select()
    .from(billingPayments)
    .where(eq(billingPayments.id, verified.paymentId))
    .then((r) => r[0]);

  if (!original) {
    return NextResponse.json({ ok: false, error: 'original_not_found' }, { status: 404 });
  }
  if (original.userId !== verified.userId) {
    return NextResponse.json({ ok: false, error: 'user_mismatch' }, { status: 400 });
  }

  // Amount sanity check: Telegram sends kopecks, we store rubles.
  const expectedKopecks = original.amountRub * 100;
  if (body.total_amount !== expectedKopecks || body.currency !== 'RUB') {
    console.error('[tg-payment-fulfill] amount mismatch', {
      expected: expectedKopecks,
      actual: body.total_amount,
    });
    return NextResponse.json({ ok: false, error: 'amount_mismatch' }, { status: 400 });
  }

  // Idempotency: if we've already processed this provider_payment_charge_id,
  // return the existing row instead of creating a duplicate.
  const existing = await db
    .select({ id: billingPayments.id })
    .from(billingPayments)
    .where(eq(billingPayments.yookassaPaymentId, body.provider_payment_charge_id))
    .then((r) => r[0]);

  if (existing) {
    return NextResponse.json({ ok: true, new_payment_id: existing.id, idempotent: true });
  }

  const newRowId = crypto.randomUUID();
  await db.insert(billingPayments).values({
    amountRub: original.amountRub,
    id: newRowId,
    metadata: {
      pricing_variant: (original.metadata as any)?.pricing_variant,
      recovery_from: original.id,
      recovery_method_used: 'tg_dm_invoice',
      telegram_payment_charge_id: body.telegram_payment_charge_id,
      tg_user_id: body.tg_user_id,
    },
    planId: original.planId,
    status: 'succeeded',
    tokensAmount: original.tokensAmount,
    type: original.type,
    userId: original.userId,
    yookassaPaymentId: body.provider_payment_charge_id,
  });

  // Credit the user via the existing fulfill path. fulfillPayment is
  // idempotent — it no-ops if status is already 'succeeded'. We just
  // inserted with status='succeeded' so the early-return path triggers;
  // fulfillPayment exists for orchestration symmetry with the webhook path.
  await fulfillPayment(db, body.provider_payment_charge_id, {});

  return NextResponse.json({ ok: true, new_payment_id: newRowId });
}
