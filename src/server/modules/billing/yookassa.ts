import crypto from 'node:crypto';

import { billingEnv } from '@/envs/billing';

interface CreatePaymentParams {
  amountRub: number;
  customerEmail?: string;
  description: string;
  metadata?: Record<string, string>;
  returnUrl: string;
}

interface YookassaPaymentResponse {
  confirmation: { confirmation_url: string };
  id: string;
  status: string;
}

export async function createYookassaPayment(
  params: CreatePaymentParams,
): Promise<{ paymentId: string; paymentUrl: string }> {
  const shopId = billingEnv.YOOKASSA_SHOP_ID;
  const secretKey = billingEnv.YOOKASSA_SECRET_KEY;
  if (!shopId || !secretKey) throw new Error('YooKassa credentials not configured');

  const idempotenceKey = crypto.randomUUID();
  const auth = Buffer.from(`${shopId}:${secretKey}`).toString('base64');

  const body: Record<string, unknown> = {
    amount: {
      currency: 'RUB',
      value: params.amountRub.toFixed(2),
    },
    capture: true,
    confirmation: {
      return_url: params.returnUrl,
      type: 'redirect',
    },
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
    paymentUrl: data.confirmation.confirmation_url,
  };
}
