import crypto from 'node:crypto';

import { billingEnv } from '@/envs/billing';

import { extractMetadataPatch, type YookassaPaymentObject } from './parse-yk-payload';

interface CreatePaymentParams {
  amountRub: number;
  customerEmail?: string;
  description: string;
  metadata?: Record<string, string>;
  /**
   * Recurring charge: when present, YooKassa attempts a no-redirect
   * charge against the previously-saved method. Only valid alongside an
   * empty `confirmation` (server-side flow). Used by the
   * renew-due-subscriptions cron.
   */
  paymentMethodId?: string;
  returnUrl: string;
  /**
   * Subscription-type initial payment: ask YooKassa to save the payment
   * method so we can charge the card on each renewal cycle without
   * redirecting the user back to the YooKassa form. The webhook
   * (`payment.succeeded`) carries the resulting `payment_method.id`,
   * which we persist on `user_billing.payment_method_id`.
   *
   * Top-ups should NOT pass this — one-shot payments don't need a saved
   * method and saving it would clutter YooKassa's payment-method list.
   */
  savePaymentMethod?: boolean;
}

interface YookassaPaymentResponse {
  confirmation?: { confirmation_url: string };
  id: string;
  payment_method?: { id?: string; saved?: boolean; type?: string };
  status: string;
}

export async function createYookassaPayment(
  params: CreatePaymentParams,
): Promise<{ paymentId: string; paymentUrl: string | null; status: string }> {
  const shopId = billingEnv.YOOKASSA_SHOP_ID;
  const secretKey = billingEnv.YOOKASSA_SECRET_KEY;
  if (!shopId || !secretKey) throw new Error('YooKassa credentials not configured');

  const idempotenceKey = crypto.randomUUID();
  const auth = Buffer.from(`${shopId}:${secretKey}`).toString('base64');

  const isRecurring = !!params.paymentMethodId;

  const body: Record<string, unknown> = {
    amount: {
      currency: 'RUB',
      value: params.amountRub.toFixed(2),
    },
    capture: true,
    description: params.description,
    metadata: params.metadata || {},
    receipt: {
      customer: {
        email: params.customerEmail || 'noreply@gptweb.ru',
      },
      items: [
        {
          amount: {
            currency: 'RUB',
            value: params.amountRub.toFixed(2),
          },
          description: params.description.slice(0, 128),
          payment_mode: 'full_payment',
          payment_subject: 'service',
          quantity: '1.00',
          vat_code: 1,
        },
      ],
    },
  };

  if (isRecurring) {
    // Server-initiated charge against an already-saved card. No redirect:
    // YooKassa moves the funds straight away; webhook fires with
    // payment.succeeded on success.
    body.payment_method_id = params.paymentMethodId;
  } else {
    body.confirmation = { return_url: params.returnUrl, type: 'redirect' };
    if (params.savePaymentMethod) {
      // Tells YooKassa to remember the card token so future recurring
      // charges can run without redirecting the user. The webhook on the
      // initial succeeded payment carries `payment_method.id`, which we
      // persist on user_billing.
      body.save_payment_method = true;
    }
  }

  const res = await fetch('https://api.yookassa.ru/v3/payments', {
    body: JSON.stringify(body),
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
      'Idempotence-Key': idempotenceKey,
    },
    method: 'POST',
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`YooKassa error ${res.status}: ${err}`);
  }

  const data: YookassaPaymentResponse = await res.json();
  return {
    paymentId: data.id,
    paymentUrl: data.confirmation?.confirmation_url ?? null,
    status: data.status,
  };
}

/**
 * Fetch the live state of a payment on YooKassa. Used by the
 * reconcile-pending-payments cron to close rows where the webhook
 * either fired and we missed it (network blip / server restart) or
 * never fired (user closed the checkout, YK auto-canceled after their
 * 7-day TTL).
 *
 * Returns null on 404 (payment never existed on YK — typically an old
 * row that was created locally but the YK request failed mid-flight).
 */
export async function fetchYookassaPaymentStatus(yookassaPaymentId: string): Promise<{
  object: YookassaPaymentObject;
  paymentMethodId?: string;
  status: string;
} | null> {
  const shopId = billingEnv.YOOKASSA_SHOP_ID;
  const secretKey = billingEnv.YOOKASSA_SECRET_KEY;
  if (!shopId || !secretKey) throw new Error('YooKassa credentials not configured');

  const auth = Buffer.from(`${shopId}:${secretKey}`).toString('base64');
  const res = await fetch(`https://api.yookassa.ru/v3/payments/${yookassaPaymentId}`, {
    headers: { Authorization: `Basic ${auth}` },
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`YooKassa GET error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as YookassaPaymentObject;
  return {
    object: data,
    paymentMethodId:
      data.payment_method?.saved && data.payment_method.id ? data.payment_method.id : undefined,
    status: data.status,
  };
}

// Re-export so callers can use extractMetadataPatch from this module if needed.
export { extractMetadataPatch };
