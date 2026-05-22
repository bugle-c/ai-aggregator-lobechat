import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createYookassaPayment } from '../yookassa';

vi.mock('@/envs/billing', () => ({
  billingEnv: { YOOKASSA_SHOP_ID: 'shop', YOOKASSA_SECRET_KEY: 'secret' },
}));

const fetchMock = vi.fn();
const origFetch = globalThis.fetch;

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as any;
});
afterEach(() => {
  globalThis.fetch = origFetch;
});

describe('createYookassaPayment paymentMethodType', () => {
  it('includes payment_method_data when paymentMethodType is set', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'pay-1',
          status: 'pending',
          confirmation: { confirmation_url: 'https://yk/url' },
        }),
        { status: 200 },
      ),
    );
    await createYookassaPayment({
      amountRub: 490,
      description: 'Top-up',
      returnUrl: 'https://ask.gptweb.ru/',
      paymentMethodType: 'sbp',
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.payment_method_data).toEqual({ type: 'sbp' });
  });

  it('omits payment_method_data when paymentMethodType is undefined', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'pay-2',
          status: 'pending',
          confirmation: { confirmation_url: 'https://yk/url' },
        }),
        { status: 200 },
      ),
    );
    await createYookassaPayment({
      amountRub: 490,
      description: 'Top-up',
      returnUrl: 'https://ask.gptweb.ru/',
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.payment_method_data).toBeUndefined();
  });

  it('falls back to non-preselected when YK returns 400 unsupported_payment_method', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            type: 'error',
            code: 'invalid_request',
            description: 'Invalid parameter payment_method_data.type',
          }),
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'pay-3',
            status: 'pending',
            confirmation: { confirmation_url: 'https://yk/fallback' },
          }),
          { status: 200 },
        ),
      );
    const result = await createYookassaPayment({
      amountRub: 490,
      description: 'Top-up',
      returnUrl: 'https://ask.gptweb.ru/',
      paymentMethodType: 'sbp',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.paymentId).toBe('pay-3');

    const firstBody = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(firstBody.payment_method_data).toBeDefined();
    const secondBody = JSON.parse((fetchMock.mock.calls[1][1] as any).body);
    expect(secondBody.payment_method_data).toBeUndefined();
  });
});
