import { describe, expect, it } from 'vitest';

import { extractMetadataPatch, type YookassaPaymentObject } from '../parse-yk-payload';

describe('extractMetadataPatch', () => {
  it('captures cancellation_details when present', () => {
    const obj: YookassaPaymentObject = {
      id: '2f5b',
      status: 'canceled',
      cancellation_details: { party: 'payment_network', reason: 'insufficient_funds' },
    };
    const patch = extractMetadataPatch(obj);
    expect(patch.cancellation).toEqual({
      party: 'payment_network',
      reason: 'insufficient_funds',
      filled_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });

  it('captures bank_card payment_method with first6/last4/issuer fields', () => {
    const obj: YookassaPaymentObject = {
      id: 'x',
      status: 'succeeded',
      payment_method: {
        type: 'bank_card',
        card: {
          first6: '220070',
          last4: '1234',
          card_type: 'MasterCard',
          issuer_country: 'RU',
          issuer_name: 'TINKOFF BANK',
        },
      },
    };
    const patch = extractMetadataPatch(obj);
    expect(patch.payment_method).toEqual({
      type: 'bank_card',
      card_first6: '220070',
      card_last4: '1234',
      card_issuer_country: 'RU',
      card_issuer_name: 'TINKOFF BANK',
      sbp_bank_id: null,
    });
  });

  it('captures sbp.bank_id when type is sbp', () => {
    const obj: YookassaPaymentObject = {
      id: 'x',
      status: 'succeeded',
      payment_method: { type: 'sbp', sbp: { bank_id: '100000000007' } },
    };
    expect(extractMetadataPatch(obj).payment_method).toEqual({
      type: 'sbp',
      card_first6: null,
      card_last4: null,
      card_issuer_country: null,
      card_issuer_name: null,
      sbp_bank_id: '100000000007',
    });
  });

  it('omits cancellation key when YK did not send cancellation_details', () => {
    const patch = extractMetadataPatch({ id: 'x', status: 'succeeded' });
    expect(patch.cancellation).toBeUndefined();
  });

  it('omits payment_method key when YK did not send payment_method', () => {
    const patch = extractMetadataPatch({ id: 'x', status: 'canceled' });
    expect(patch.payment_method).toBeUndefined();
  });

  it('survives missing nested fields without throwing', () => {
    const obj: YookassaPaymentObject = {
      id: 'x',
      status: 'canceled',
      payment_method: { type: 'bank_card' /* no card */ },
      cancellation_details: { party: 'unknown' /* no reason */ } as any,
    };
    const patch = extractMetadataPatch(obj);
    expect(patch.cancellation?.reason).toBeUndefined();
    expect(patch.payment_method?.card_first6).toBeNull();
  });
});
