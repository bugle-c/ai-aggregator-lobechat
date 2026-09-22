import { describe, expect, it } from 'vitest';

import { type BalanceSource, formatMskTime, selectBalanceView } from './balanceView';

const free = (over: Partial<BalanceSource> = {}): BalanceSource => ({
  creditsUsed: 36,
  dailyGateBypassed: false,
  dailyQuota: 5,
  dailyRemaining: 2,
  dailyResetAt: '2026-09-22T21:00:00.000Z', // 00:00 MSK next day
  purchasedRemaining: 0,
  totalAvailable: 2500,
  ...over,
});

describe('selectBalanceView', () => {
  it('free + no purchase → daily copy, never the monthly pool', () => {
    expect(selectBalanceView(free())).toEqual({
      kind: 'daily',
      quota: 5,
      remaining: 2,
      resetTime: '00:00',
      used: 3,
    });
  });

  it('free + purchased credits lifting the gate → credits copy with the purchased remainder', () => {
    expect(
      selectBalanceView(free({ dailyGateBypassed: true, purchasedRemaining: 364 })),
    ).toEqual({ kind: 'purchased', remaining: 364 });
  });

  it('free + purchase already spent → back to the daily copy', () => {
    const view = selectBalanceView(free({ dailyGateBypassed: false, purchasedRemaining: 0 }));
    expect(view.kind).toBe('daily');
  });

  it('paid plan → unchanged monthly credits', () => {
    expect(
      selectBalanceView({
        creditsUsed: 120,
        dailyGateBypassed: false,
        dailyQuota: null,
        dailyRemaining: null,
        dailyResetAt: null,
        purchasedRemaining: 0,
        totalAvailable: 8000,
      }),
    ).toEqual({ kind: 'credits', remaining: 7880, total: 8000 });
  });

  it('clamps today\'s usage to the quota when the refused 6th message was persisted', () => {
    const view = selectBalanceView(free({ dailyRemaining: 0 }));
    expect(view).toMatchObject({ kind: 'daily', remaining: 0, used: 5 });
  });

  it('tolerates a response from a server that predates the bypass fields', () => {
    const { dailyGateBypassed: _b, purchasedRemaining: _p, ...legacy } = free();
    expect(selectBalanceView(legacy).kind).toBe('daily');
  });
});

describe('formatMskTime', () => {
  it('renders the Moscow wall-clock time of the reset instant', () => {
    expect(formatMskTime('2026-09-22T21:00:00.000Z')).toBe('00:00');
    expect(formatMskTime('2026-09-22T12:30:00.000Z')).toBe('15:30');
  });

  it('falls back to 00:00 for missing or malformed input', () => {
    expect(formatMskTime(null)).toBe('00:00');
    expect(formatMskTime('not-a-date')).toBe('00:00');
  });
});
