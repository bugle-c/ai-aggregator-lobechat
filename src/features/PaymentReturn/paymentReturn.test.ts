import { describe, expect, it } from 'vitest';

import {
  agentIdFromPath,
  decidePaymentReturn,
  isPlansPath,
  MAX_PENDING_ATTEMPTS,
  recoveryPlansPath,
} from './paymentReturn';

describe('decidePaymentReturn', () => {
  it('keeps polling while the row is not loaded, but not past the budget (query errors)', () => {
    expect(decidePaymentReturn({ attempts: 0, status: undefined })).toEqual({ kind: 'poll' });
    expect(decidePaymentReturn({ attempts: MAX_PENDING_ATTEMPTS - 1, status: undefined })).toEqual(
      { kind: 'poll' },
    );
    expect(decidePaymentReturn({ attempts: MAX_PENDING_ATTEMPTS, status: undefined })).toEqual({
      kind: 'recover',
      reason: 'timeout',
    });
  });

  it('celebrates on succeeded regardless of attempts', () => {
    expect(decidePaymentReturn({ attempts: 0, status: 'succeeded' })).toEqual({
      kind: 'succeeded',
    });
    expect(decidePaymentReturn({ attempts: 50, status: 'succeeded' })).toEqual({
      kind: 'succeeded',
    });
  });

  it('polls a pending row within the budget, then times out to recovery', () => {
    expect(decidePaymentReturn({ attempts: 0, status: 'pending' })).toEqual({ kind: 'poll' });
    expect(decidePaymentReturn({ attempts: MAX_PENDING_ATTEMPTS - 1, status: 'pending' })).toEqual(
      { kind: 'poll' },
    );
    expect(decidePaymentReturn({ attempts: MAX_PENDING_ATTEMPTS, status: 'pending' })).toEqual({
      kind: 'recover',
      reason: 'timeout',
    });
  });

  it('sends terminal failures to recovery immediately', () => {
    expect(decidePaymentReturn({ attempts: 0, status: 'canceled' })).toEqual({
      kind: 'recover',
      reason: 'canceled',
    });
    expect(decidePaymentReturn({ attempts: 0, status: 'failed' })).toEqual({
      kind: 'recover',
      reason: 'failed',
    });
  });

  it('treats a missing row (null) or an unknown status as recovery, not an endless spin', () => {
    expect(decidePaymentReturn({ attempts: 0, status: null })).toEqual({
      kind: 'recover',
      reason: 'unknown',
    });
    expect(decidePaymentReturn({ attempts: 0, status: 'weird' })).toEqual({
      kind: 'recover',
      reason: 'unknown',
    });
  });
});

describe('route helpers', () => {
  it('detects the plans page (which keeps its own handler)', () => {
    expect(isPlansPath('/settings/plans')).toBe(true);
    expect(isPlansPath('/settings/plans/')).toBe(true);
    expect(isPlansPath('/settings/plansx')).toBe(false);
    expect(isPlansPath('/settings/billing')).toBe(false);
    expect(isPlansPath('/agent/abc')).toBe(false);
    expect(isPlansPath(null)).toBe(false);
  });

  it('extracts the agent id from chat routes only', () => {
    expect(agentIdFromPath('/agent/abc-123')).toBe('abc-123');
    expect(agentIdFromPath('/agent/abc-123/settings')).toBe('abc-123');
    expect(agentIdFromPath('/home')).toBeNull();
    expect(agentIdFromPath('/group/g1')).toBeNull();
    expect(agentIdFromPath(undefined)).toBeNull();
  });

  it('builds the plans recovery url with the payment id', () => {
    expect(recoveryPlansPath('p 1')).toBe('/settings/plans?recoveryFor=p%201');
  });
});
