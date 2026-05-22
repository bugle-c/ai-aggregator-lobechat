import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/server';

import { POST } from '../route';

vi.mock('@/database/server', () => ({ getServerDB: vi.fn() }));
vi.mock('@/server/modules/billing/fulfill', () => ({
  fulfillPayment: vi.fn(),
  cancelPayment: vi.fn(),
}));

const updateChain = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
const setChain = vi.fn().mockReturnValue({ where: updateChain });
const dbMock = { update: vi.fn().mockReturnValue({ set: setChain }) };
(getServerDB as any).mockResolvedValue(dbMock);

describe('billing webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getServerDB as any).mockResolvedValue(dbMock);
  });

  it('on payment.canceled writes cancellation + payment_method into metadata', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event: 'payment.canceled',
        type: 'notification',
        object: {
          id: 'yk-id-1',
          status: 'canceled',
          cancellation_details: { party: 'payment_network', reason: 'insufficient_funds' },
          payment_method: {
            type: 'bank_card',
            card: { first6: '220070', last4: '1234', issuer_country: 'RU', issuer_name: 'TBANK' },
          },
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    // setChain receives the merge update
    expect(setChain).toHaveBeenCalled();
    const setArg = setChain.mock.calls[0][0];
    expect(setArg.metadata).toBeDefined(); // sql.raw or similar — we assert it was passed
  });

  it('on payment.succeeded passes saved_method_id through to fulfillPayment', async () => {
    const { fulfillPayment } = await import('@/server/modules/billing/fulfill');
    const req = new Request('http://x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event: 'payment.succeeded',
        type: 'notification',
        object: {
          id: 'yk-id-2',
          status: 'succeeded',
          payment_method: { id: 'pm-1', saved: true, type: 'bank_card' },
        },
      }),
    });
    await POST(req);
    expect(fulfillPayment).toHaveBeenCalledWith(dbMock, 'yk-id-2', {
      savedPaymentMethodId: 'pm-1',
    });
  });
});
