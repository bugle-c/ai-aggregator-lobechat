import { beforeEach, describe, expect, it, vi } from 'vitest';

import { firePaymentSuccessOnce, PAYMENT_SUCCESS_FIRED_PREFIX } from './paymentSuccessGoal';

const reachGoal = vi.fn();
vi.mock('@/business/client/analytics/ym', () => ({
  reachGoal: (...args: unknown[]) => reachGoal(...args),
}));

describe('firePaymentSuccessOnce', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('fires payment_success with the payment kind', () => {
    expect(firePaymentSuccessOnce('pay-1', 'topup')).toBe(true);
    expect(reachGoal).toHaveBeenCalledWith('payment_success', { kind: 'topup' });
    expect(sessionStorage.getItem(`${PAYMENT_SUCCESS_FIRED_PREFIX}pay-1`)).toBe('1');
  });

  it('never fires twice for the same payment id, whatever the kind', () => {
    firePaymentSuccessOnce('pay-1', 'topup');
    expect(firePaymentSuccessOnce('pay-1', 'topup')).toBe(false);
    // Both handlers seeing the same id (topUpFor + recoveryFor on one URL)
    // must still produce exactly one conversion.
    expect(firePaymentSuccessOnce('pay-1', 'subscribe')).toBe(false);
    expect(reachGoal).toHaveBeenCalledTimes(1);
  });

  it('fires separately for distinct payment ids', () => {
    firePaymentSuccessOnce('pay-1', 'topup');
    firePaymentSuccessOnce('pay-2', 'subscribe');
    expect(reachGoal).toHaveBeenCalledTimes(2);
    expect(reachGoal).toHaveBeenLastCalledWith('payment_success', { kind: 'subscribe' });
  });

  it('ignores an empty payment id', () => {
    expect(firePaymentSuccessOnce('', 'topup')).toBe(false);
    expect(reachGoal).not.toHaveBeenCalled();
  });
});
