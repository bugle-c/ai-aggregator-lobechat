import { describe, expect, it } from 'vitest';

import { describeReason, REASON_MAP } from '../cancellation-reasons';

describe('cancellation-reasons', () => {
  it('maps insufficient_funds to a Russian human-readable text and retry-same suggestion', () => {
    const r = describeReason('insufficient_funds');
    expect(r.text).toBe('На карте не хватило средств');
    expect(r.suggest).toBe('retry_same');
  });

  it('maps card-related rejections to sbp suggestion', () => {
    expect(describeReason('payment_method_restricted').suggest).toBe('sbp');
    expect(describeReason('card_expired').suggest).toBe('sbp');
    expect(describeReason('country_forbidden').suggest).toBe('sbp');
    expect(describeReason('3d_secure_failed').suggest).toBe('sbp');
    expect(describeReason('general_decline').suggest).toBe('sbp');
    expect(describeReason('permission_revoked').suggest).toBe('sbp');
  });

  it('maps expiry/timeout reasons to retry suggestion', () => {
    expect(describeReason('expired_on_confirmation').suggest).toBe('retry');
    expect(describeReason('expired_on_capture').suggest).toBe('retry');
    expect(describeReason('canceled_by_merchant').suggest).toBe('retry');
    expect(describeReason('internal_timeout').suggest).toBe('retry');
  });

  it('maps fraud_suspected to support channel', () => {
    expect(describeReason('fraud_suspected').suggest).toBe('support');
  });

  it('returns a generic fallback for unknown / null reasons', () => {
    expect(describeReason('something_new').text).toBe('Платёж не прошёл');
    expect(describeReason('something_new').suggest).toBe('sbp');
    expect(describeReason(null).text).toBe('Платёж не прошёл');
    expect(describeReason(undefined).text).toBe('Платёж не прошёл');
  });

  it('exports REASON_MAP keyed by all documented YK reasons', () => {
    for (const key of [
      'insufficient_funds',
      'payment_method_restricted',
      'card_expired',
      'country_forbidden',
      '3d_secure_failed',
      'general_decline',
      'expired_on_confirmation',
      'expired_on_capture',
      'canceled_by_merchant',
      'permission_revoked',
      'internal_timeout',
      'fraud_suspected',
    ]) {
      expect(REASON_MAP[key]).toBeDefined();
      expect(REASON_MAP[key].text).toBeTruthy();
      expect(REASON_MAP[key].suggest).toBeTruthy();
    }
  });
});
