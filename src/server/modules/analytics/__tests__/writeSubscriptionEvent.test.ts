import { describe, expect, it } from 'vitest';

import { classifySubscriptionEvent } from '../writeSubscriptionEvent';

describe('classifySubscriptionEvent', () => {
  it('classifies first-time subscription as created', () => {
    expect(
      classifySubscriptionEvent({
        fromPlanPrice: 0,
        toPlanPrice: 490,
        currentExpiresAt: null,
      }),
    ).toEqual({ eventType: 'created', mrrDeltaRub: 490 });
  });

  it('classifies upgrade from paid to higher-paid', () => {
    expect(
      classifySubscriptionEvent({
        fromPlanPrice: 490,
        toPlanPrice: 990,
        currentExpiresAt: new Date('2099-01-01'),
      }),
    ).toEqual({ eventType: 'upgraded', mrrDeltaRub: 500 });
  });

  it('classifies renewal when same plan and already active', () => {
    expect(
      classifySubscriptionEvent({
        fromPlanPrice: 490,
        toPlanPrice: 490,
        currentExpiresAt: new Date('2099-01-01'),
      }),
    ).toEqual({ eventType: 'renewed', mrrDeltaRub: 0 });
  });

  it('classifies reactivation when subscription was expired', () => {
    expect(
      classifySubscriptionEvent({
        fromPlanPrice: 490,
        toPlanPrice: 490,
        currentExpiresAt: new Date('2020-01-01'),
      }),
    ).toEqual({ eventType: 'reactivation', mrrDeltaRub: 490 });
  });

  it('classifies downgrade', () => {
    expect(
      classifySubscriptionEvent({
        fromPlanPrice: 990,
        toPlanPrice: 490,
        currentExpiresAt: new Date('2099-01-01'),
      }),
    ).toEqual({ eventType: 'downgraded', mrrDeltaRub: -500 });
  });

  it('classifies cancellation when toPlanPrice is 0', () => {
    expect(
      classifySubscriptionEvent({
        fromPlanPrice: 490,
        toPlanPrice: 0,
        currentExpiresAt: new Date('2099-01-01'),
      }),
    ).toEqual({ eventType: 'cancelled', mrrDeltaRub: -490 });
  });
});
