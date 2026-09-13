import { describe, expect, it } from 'vitest';

import { decideUsageLimit } from '../checkUsageLimit';
import { FREE_DAILY_MESSAGE_QUOTA, moscowDayStart, nextMoscowDayStart } from '../daily-quota';

describe('moscowDayStart — reset at 00:00 Europe/Moscow (UTC+3)', () => {
  it('maps an instant late in the MSK day to 21:00 UTC of the previous calendar day', () => {
    // 2026-09-13 23:59:59 MSK = 2026-09-13 20:59:59 UTC → day started 2026-09-12 21:00 UTC
    expect(moscowDayStart(new Date('2026-09-13T20:59:59.999Z')).toISOString()).toBe(
      '2026-09-12T21:00:00.000Z',
    );
  });

  it('rolls over exactly at 21:00 UTC (= 00:00 MSK)', () => {
    expect(moscowDayStart(new Date('2026-09-13T21:00:00.000Z')).toISOString()).toBe(
      '2026-09-13T21:00:00.000Z',
    );
  });

  it('an instant in the UTC morning belongs to the same MSK day', () => {
    expect(moscowDayStart(new Date('2026-09-13T05:00:00Z')).toISOString()).toBe(
      '2026-09-12T21:00:00.000Z',
    );
  });

  it('nextMoscowDayStart is +24h from the current day start', () => {
    expect(nextMoscowDayStart(new Date('2026-09-13T05:00:00Z')).toISOString()).toBe(
      '2026-09-13T21:00:00.000Z',
    );
  });
});

const freeChat = (over: Partial<Parameters<typeof decideUsageLimit>[0]> = {}) =>
  decideUsageLimit({
    bonus: 0,
    creditLimit: 150,
    dailyUsed: 0,
    kind: 'chat',
    planSlug: 'free',
    tokenBalance: 0,
    tokensUsedMonth: 0,
    ...over,
  });

describe('decideUsageLimit — EXP-003 free daily quota', () => {
  it('quota is 5 messages per day', () => {
    expect(FREE_DAILY_MESSAGE_QUOTA).toBe(5);
  });

  it('allows the 5th message of the day (4 used) and reports 1 remaining', () => {
    const r = freeChat({ dailyUsed: 4, tokensUsedMonth: 4 });
    expect(r.allowed).toBe(true);
    expect(r.dailyRemaining).toBe(1);
    expect(r.dailyQuota).toBe(5);
  });

  it('blocks the 6th message (5 used) with reason=daily_quota', () => {
    const r = freeChat({ dailyUsed: 5, tokensUsedMonth: 5 });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('daily_quota');
    expect(r.dailyRemaining).toBe(0);
    expect(r.message).toMatch(/Лимит на сегодня исчерпан/);
    expect(r.message).toMatch(/00:00 по Москве/);
  });

  it('bonus credits let the 6th message through (existing credit path)', () => {
    const r = freeChat({ bonus: 100, dailyUsed: 5, tokensUsedMonth: 5 });
    expect(r.allowed).toBe(true);
    expect(r.creditsRemaining).toBe(245);
  });

  it('top-up credits let the 6th message through', () => {
    const r = freeChat({ dailyUsed: 7, tokenBalance: 50, tokensUsedMonth: 7 });
    expect(r.allowed).toBe(true);
  });

  it('extra credits already spent (counter above the allowance) → daily quota applies again', () => {
    // allowance 150 + top-up 50 = 200; used 200 → monthly block, reason=credits
    expect(freeChat({ dailyUsed: 5, tokenBalance: 50, tokensUsedMonth: 200 })).toMatchObject({
      allowed: false,
      reason: 'credits',
    });
    // allowance 150 + bonus expired (0) — counter 160 → monthly cap
    expect(freeChat({ dailyUsed: 5, tokensUsedMonth: 160 })).toMatchObject({
      allowed: false,
      reason: 'monthly_cap',
    });
  });

  it('paid plan is unaffected by the daily count', () => {
    const r = decideUsageLimit({
      bonus: 0,
      creditLimit: 2500,
      dailyUsed: 50,
      kind: 'chat',
      planSlug: 'basic',
      tokenBalance: 0,
      tokensUsedMonth: 100,
    });
    expect(r.allowed).toBe(true);
    expect(r.dailyQuota).toBeUndefined();
    expect(r.dailyRemaining).toBeUndefined();
  });

  it('monthly cap still blocks at 150 with reason=monthly_cap', () => {
    const r = freeChat({ dailyUsed: 2, tokensUsedMonth: 150 });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('monthly_cap');
    expect(r.creditsRemaining).toBe(0);
  });

  it('works with the legacy 30-credit limit too (daily quota still binding below the cap)', () => {
    expect(freeChat({ creditLimit: 30, dailyUsed: 5, tokensUsedMonth: 10 })).toMatchObject({
      allowed: false,
      reason: 'daily_quota',
    });
    expect(freeChat({ creditLimit: 30, dailyUsed: 1, tokensUsedMonth: 30 })).toMatchObject({
      allowed: false,
      reason: 'monthly_cap',
    });
  });

  it('paid plan out of credits → reason=credits', () => {
    const r = decideUsageLimit({
      bonus: 0,
      creditLimit: 2500,
      kind: 'chat',
      planSlug: 'pro',
      tokenBalance: 0,
      tokensUsedMonth: 2500,
    });
    expect(r).toMatchObject({ allowed: false, reason: 'credits' });
  });

  it('image/video generation on the free plan is not gated by the daily quota', () => {
    expect(freeChat({ dailyUsed: 5, kind: 'image' })).toMatchObject({ allowed: true });
    expect(freeChat({ dailyUsed: 5, kind: 'video' })).toMatchObject({ allowed: true });
  });
});
