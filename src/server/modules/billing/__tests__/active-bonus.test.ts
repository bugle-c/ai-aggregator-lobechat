import { describe, expect, it } from 'vitest';

import { activeBonusFor } from '../active-bonus';

describe('activeBonusFor', () => {
  const future = new Date(Date.now() + 86_400_000);
  const past = new Date(Date.now() - 1000);

  it('returns 0 for null/undefined input', () => {
    expect(activeBonusFor(null)).toBe(0);
    expect(activeBonusFor(undefined)).toBe(0);
  });

  it('returns 0 when bonusBalance is 0', () => {
    expect(activeBonusFor({ bonusBalance: 0, bonusBalanceExpiresAt: future })).toBe(0);
  });

  it('returns 0 when expiry is in the past', () => {
    expect(activeBonusFor({ bonusBalance: 100, bonusBalanceExpiresAt: past })).toBe(0);
  });

  it('returns 0 when expiry is null', () => {
    expect(activeBonusFor({ bonusBalance: 100, bonusBalanceExpiresAt: null })).toBe(0);
  });

  it('returns bonusBalance when active', () => {
    expect(activeBonusFor({ bonusBalance: 100, bonusBalanceExpiresAt: future })).toBe(100);
  });
});
