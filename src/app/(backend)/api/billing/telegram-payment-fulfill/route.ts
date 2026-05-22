import crypto from 'node:crypto';

import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { billingPayments, userBilling } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { fulfillPayment } from '@/server/modules/billing/fulfill';

export const dynamic = 'force-dynamic';

interface Body {
  currency: string; // 'RUB'
  invoice_payload: string; // bare paymentId UUID (Telegram caps payload at 128 bytes)
  provider_payment_charge_id: string;
  telegram_payment_charge_id: string;
  tg_user_id: number;
  total_amount: number; // KOPECKS
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  // Auth layer 1: X-Internal-Token. Only the bot (which holds the same
  // secret in its env) can call this endpoint. Combined with the
  // tg_user_id ↔ user_billing.tg_bot_chat_id verification below, this
  // is the full authentication chain.
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

  // invoice_payload now carries the bare paymentId UUID — Telegram caps
  // invoice_payload at 128 bytes and an HMAC token with two UUID claims
  // overran that. Validate the shape minimally.
  if (!body.invoice_payload || !UUID_RE.test(body.invoice_payload)) {
    return NextResponse.json({ ok: false, error: 'invalid_payload' }, { status: 400 });
  }

  const db = await getServerDB();
  const original = await db
    .select()
    .from(billingPayments)
    .where(eq(billingPayments.id, body.invoice_payload))
    .then((r) => r[0]);

  if (!original) {
    return NextResponse.json({ ok: false, error: 'original_not_found' }, { status: 404 });
  }

  // Auth layer 2: the Telegram user who paid must own the original
  // payment. Verify via user_billing.tg_bot_chat_id == tg_user_id.
  const ub = await db
    .select({ tgBotChatId: userBilling.tgBotChatId })
    .from(userBilling)
    .where(eq(userBilling.userId, original.userId))
    .then((r) => r[0]);

  if (!ub?.tgBotChatId || Number(ub.tgBotChatId) !== Number(body.tg_user_id)) {
    console.error('[tg-payment-fulfill] tg_user_id mismatch', {
      expected: ub?.tgBotChatId,
      actual: body.tg_user_id,
      paymentId: body.invoice_payload,
    });
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
