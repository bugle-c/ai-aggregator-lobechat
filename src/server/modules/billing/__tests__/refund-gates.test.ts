import { describe, expect, it } from 'vitest';

import { decideUsageLimit } from '../checkUsageLimit';

const exhaustedFree = { bonus: 0, creditLimit: 100, dailyUsed: 50, kind: 'chat' as const,
  planSlug: 'free', tokenBalance: 0, tokensUsedMonth: 100 };

describe('expiring refunds in usage gates', () => {
  it('refund-backed free customer bypasses daily quota without receiving plan entitlement', () => {
    expect(decideUsageLimit({ ...exhaustedFree, refundRemaining: 12 })).toMatchObject({ allowed: true, creditsRemaining: 12 });
  });
  it('expiry or depletion immediately restores the normal free-plan gate', () => {
    expect(decideUsageLimit({ ...exhaustedFree, refundRemaining: 0 })).toMatchObject({ allowed: false, creditsRemaining: 0 });
  });
  it('prior ordinary overuse cannot erase independent correction credits', () => {
    expect(decideUsageLimit({ ...exhaustedFree, tokensUsedMonth: 1000, refundRemaining: 12 })).toMatchObject({ allowed: true, creditsRemaining: 12 });
  });
  it('ordinary bonus is still not a paid daily quota bypass', () => {
    expect(decideUsageLimit({ ...exhaustedFree, bonus: 30, refundRemaining: 0 })).toMatchObject({ allowed: false, reason: 'daily_quota' });
  });
});
