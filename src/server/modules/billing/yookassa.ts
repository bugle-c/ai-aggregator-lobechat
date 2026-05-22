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
  /**
   * Pre-select payment method on the YooKassa hosted form. Other methods
   * remain accessible via "Выбрать другой способ оплаты". We default to
   * 'sbp' for new top-ups based on RU 2026 conversion data — bank cards
   * are 2-3× more likely to be rejected (TINKOFF / other RU banks block
   * 3DS on online merchants, foreign-issued cards fail country checks).
   */
  paymentMethodType?: 'sbp' | 'bank_card' | 'yoo_money' | 'sber_b2b' | 'tinkoff_bank';
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

  const auth = Buffer.from(`${shopId}:${secretKey}`).toString('base64');
  const isRecurring = !!params.paymentMethodId;

  const buildBody = (
    withMethod: boolean,
    withSaveMethod: boolean = true,
  ): Record<string, unknown> => {
    const body: Record<string, unknown> = {
      amount: { currency: 'RUB', value: params.amountRub.toFixed(2) },
      capture: true,
      description: params.description,
      metadata: params.metadata || {},
      receipt: {
        customer: { email: params.customerEmail || 'noreply@gptweb.ru' },
        items: [
          {
            amount: { currency: 'RUB', value: params.amountRub.toFixed(2) },
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
      if (withSaveMethod && params.savePaymentMethod) {
        // Tells YooKassa to remember the card token so future recurring
        // charges can run without redirecting the user. The webhook on the
        // initial succeeded payment carries `payment_method.id`, which we
        // persist on user_billing.
        //
        // Some YooKassa shops don't have "recurring payments" enabled at
        // the contract level — YK returns 403 forbidden. We retry once
        // with `withSaveMethod=false` so the purchase still completes as
        // a one-shot. See the fallback below.
        body.save_payment_method = true;
      }
      if (withMethod && params.paymentMethodType) {
        body.payment_method_data = { type: params.paymentMethodType };
      }
    }
    return body;
  };

  const callYK = async (
    body: Record<string, unknown>,
  ): Promise<{ ok: boolean; status: number; json: any }> => {
    const res = await fetch('https://api.yookassa.ru/v3/payments', {
      body: JSON.stringify(body),
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Idempotence-Key': crypto.randomUUID(),
      },
      method: 'POST',
    });
    const json = await res.json();
    return { ok: res.ok, status: res.status, json };
  };

  let withMethod = true;
  let withSaveMethod = true;
  let attempt = await callYK(buildBody(withMethod, withSaveMethod));

  // Fallback 1: YK rejected our preselected method (not enabled in this
  // shop, or unknown). Retry without payment_method_data. Logged so we
  // notice if SBP needs to be enabled in the Kabinet.
  const unsupportedMethod =
    !attempt.ok &&
    attempt.status === 400 &&
    typeof attempt.json?.description === 'string' &&
    /payment_method_data/i.test(attempt.json.description);

  if (unsupportedMethod && params.paymentMethodType) {
    console.warn(
      `[billing] YK rejected payment_method_data.type=${params.paymentMethodType} — falling back to default. Configure this method in the YK Kabinet.`,
    );
    withMethod = false;
    attempt = await callYK(buildBody(withMethod, withSaveMethod));
  }

  // Fallback 2: YK shop doesn't have recurring/auto-payments enabled at
  // the contract level. The 403 description reads "This store can't make
  // recurring payments. Contact the YooMoney manager…". Retry once
  // without save_payment_method — the purchase completes as a one-shot,
  // user just won't get auto-renew until the shop's contract enables it.
  const recurringForbidden =
    !attempt.ok &&
    attempt.status === 403 &&
    typeof attempt.json?.description === 'string' &&
    /recurring/i.test(attempt.json.description);

  if (recurringForbidden && params.savePaymentMethod) {
    console.warn(
      '[billing] YK rejected save_payment_method (shop lacks recurring permission) — falling back to one-shot. Contact YK manager to enable recurring on the shop contract.',
    );
    withSaveMethod = false;
    attempt = await callYK(buildBody(withMethod, withSaveMethod));
  }

  if (!attempt.ok) {
    throw new Error(
      `YooKassa createPayment failed: ${attempt.status} ${JSON.stringify(attempt.json)}`,
    );
  }

  const data = attempt.json as YookassaPaymentResponse;
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
