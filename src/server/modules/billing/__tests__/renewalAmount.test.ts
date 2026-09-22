import { describe, expect, it } from 'vitest';

import { resolveRenewalAmount, resolveRenewalPlanId } from '../renewalAmount';

describe('resolveRenewalAmount (price lock)', () => {
  it('charges what the subscriber last actually paid, not the current list price', () => {
    // Admin edited the tariff 490 → 790 after the user subscribed.
    expect(resolveRenewalAmount({ amountRub: 490, planId: 2 }, 2, 790)).toBe(490);
  });

  it('honours a price DROP the same way — the locked amount wins', () => {
    expect(resolveRenewalAmount({ amountRub: 490, planId: 2 }, 2, 290)).toBe(490);
  });

  it('falls back to the current price when there is no prior payment', () => {
    expect(resolveRenewalAmount(null, 2, 790)).toBe(790);
  });

  it('falls back to the current price when the last payment was for another plan', () => {
    // User upgraded 2 → 3; the old tier's amount is simply the wrong number.
    expect(resolveRenewalAmount({ amountRub: 490, planId: 2 }, 3, 1290)).toBe(1290);
  });

  it('falls back when the last payment row has no plan_id', () => {
    expect(resolveRenewalAmount({ amountRub: 490, planId: null }, 2, 790)).toBe(790);
  });
});

describe('resolveRenewalPlanId (dunning after downgrade)', () => {
  it('uses the current plan while the subscription is still active', () => {
    expect(resolveRenewalPlanId(2, { amountRub: 490, planId: 3 })).toBe(2);
  });

  it('falls back to the last paid tier once expireSubscriptions downgraded to free', () => {
    // This is the case the old `ne(plan_id, 1)` filter made unreachable.
    expect(resolveRenewalPlanId(1, { amountRub: 490, planId: 2 })).toBe(2);
  });

  it('returns null when a free row has never paid for a subscription', () => {
    expect(resolveRenewalPlanId(1, null)).toBeNull();
  });

  it('returns null when the last payment was itself for the free plan', () => {
    expect(resolveRenewalPlanId(1, { amountRub: 0, planId: 1 })).toBeNull();
  });

  it('returns null when the last payment row carries no plan_id', () => {
    expect(resolveRenewalPlanId(1, { amountRub: 490, planId: null })).toBeNull();
  });
});
