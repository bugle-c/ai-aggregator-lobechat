import crypto from 'node:crypto';

import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

import { billingPayments, userBilling } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { appEnv } from '@/envs/app';
import { authEnv } from '@/envs/auth';
import { verifyRecoveryToken } from '@/server/modules/billing/recovery-token';
import { createYookassaPayment } from '@/server/modules/billing/yookassa';

/**
 * GET /api/billing/recovery-retry?payment=<id>&method=sbp|any&t=<hmac>
 *
 * Bot-issued recovery links land here. The HMAC token in `t` vouches
 * for the tuple (paymentId, userId, method) — we verify, look up the
 * original failed payment row, and restart the purchase using the
 * same plan / amount / type. No session required: the HMAC IS the
 * authentication.
 *
 * Always 302s — either to the new YooKassa URL on success, or to a
 * branded error page on the site (`/?recovery_error=<code>`).
 */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const paymentId = sp.get('payment');
  const method = sp.get('method');
  const t = sp.get('t');

  if (!paymentId || !t || (method !== 'sbp' && method !== 'any')) {
    return NextResponse.redirect(new URL('/?recovery_error=bad_params', req.url));
  }

  const secret = authEnv.AUTH_SECRET || process.env.AUTH_SECRET;
  if (!secret) {
    console.error('[recovery-retry] AUTH_SECRET missing');
    return NextResponse.redirect(new URL('/?recovery_error=server_misconfigured', req.url));
  }

  const verified = verifyRecoveryToken(t, secret);
  if (!verified) {
    return NextResponse.redirect(new URL('/?recovery_error=invalid_token', req.url));
  }
  if (verified.paymentId !== paymentId || verified.method !== method) {
    return NextResponse.redirect(new URL('/?recovery_error=token_mismatch', req.url));
  }

  const db = await getServerDB();
  const original = await db
    .select()
    .from(billingPayments)
    .where(eq(billingPayments.id, paymentId))
    .then((r) => r[0]);

  if (!original) {
    return NextResponse.redirect(new URL('/?recovery_error=not_found', req.url));
  }
  if (original.userId !== verified.userId) {
    return NextResponse.redirect(new URL('/?recovery_error=token_mismatch', req.url));
  }

  const ub = await db
    .select({ tgBotChatId: userBilling.tgBotChatId })
    .from(userBilling)
    .where(eq(userBilling.userId, original.userId))
    .then((r) => r[0]);

  try {
    const yk = await createYookassaPayment({
      amountRub: original.amountRub,
      description: original.type === 'subscription' ? 'Подписка (повтор)' : 'Пополнение (повтор)',
      paymentMethodType: method === 'sbp' ? 'sbp' : undefined,
      returnUrl: `${appEnv.APP_URL}/?payment=success`,
      savePaymentMethod: original.type === 'subscription',
    });

    const newRowId = crypto.randomUUID();
    await db.insert(billingPayments).values({
      amountRub: original.amountRub,
      id: newRowId,
      metadata: {
        pricing_variant: (original.metadata as any)?.pricing_variant,
        recovery_from: original.id,
        recovery_method_used: 'tg_dm',
        sbp_preselected: method === 'sbp',
        tg_user_id: ub?.tgBotChatId ?? null,
      },
      planId: original.planId,
      status: 'pending',
      tokensAmount: original.tokensAmount,
      type: original.type,
      userId: original.userId,
      yookassaPaymentId: yk.paymentId,
    });

    if (!yk.paymentUrl) {
      return NextResponse.redirect(new URL('/?recovery_error=yk_no_url', req.url));
    }
    return NextResponse.redirect(yk.paymentUrl, 302);
  } catch (err) {
    console.error('[recovery-retry] failed for paymentId=' + paymentId, err);
    return NextResponse.redirect(new URL('/?recovery_error=yk_failed', req.url));
  }
}
