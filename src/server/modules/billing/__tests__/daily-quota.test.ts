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

// `dailyUsed` = user messages persisted today INCLUDING the one being answered
// (the client persists the user message before the streaming gate runs).
const freeChat = (over: Partial<Parameters<typeof decideUsageLimit>[0]> = {}) =>
  decideUsageLimit({
    bonus: 0,
    creditLimit: 150,
    dailyUsed: 1,
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

  it('allows the 5th message of the day (5 persisted incl. current) and reports 0 remaining', () => {
    const r = freeChat({ dailyUsed: 5, tokensUsedMonth: 4 });
    expect(r.allowed).toBe(true);
    expect(r.dailyRemaining).toBe(0);
    expect(r.dailyQuota).toBe(5);
  });

  it('4 persisted → 1 message left today', () => {
    expect(freeChat({ dailyUsed: 4 }).dailyRemaining).toBe(1);
  });

  it('blocks the 6th message (6 persisted incl. current) with reason=daily_quota', () => {
    const r = freeChat({ dailyUsed: 6, tokensUsedMonth: 5 });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('daily_quota');
    expect(r.dailyRemaining).toBe(0);
    expect(r.message).toMatch(/Лимит на сегодня исчерпан/);
    expect(r.message).toMatch(/00:00 по Москве/);
  });

  it('active TG-link bonus does NOT lift the daily quota (bonus only extends the monthly pool)', () => {
    const r = freeChat({ bonus: 100, dailyUsed: 6, tokensUsedMonth: 5 });
    expect(r).toMatchObject({ allowed: false, reason: 'daily_quota' });
  });

  it('purchased credits (token_balance=400, used 100) lift the daily quota even at the 6th message', () => {
    const r = freeChat({ dailyUsed: 6, tokenBalance: 400, tokensUsedMonth: 100 });
    expect(r.allowed).toBe(true);
    expect(r.creditsRemaining).toBe(450);
  });

  it('bypass ends once the counter passes the purchase (used 541 > 400) → daily_quota', () => {
    // hotfix 2026-09-14: the free allowance is NOT part of the bypass budget
    const r = freeChat({
      creditLimit: 2500,
      dailyUsed: 6,
      tokenBalance: 400,
      tokensUsedMonth: 541,
    });
    expect(r).toMatchObject({ allowed: false, reason: 'daily_quota' });
  });

  it('bypass holds while used < token_balance, edge: used == token_balance → gated', () => {
    expect(freeChat({ dailyUsed: 9, tokenBalance: 50, tokensUsedMonth: 49 })).toMatchObject({
      allowed: true,
    });
    expect(freeChat({ dailyUsed: 9, tokenBalance: 50, tokensUsedMonth: 50 })).toMatchObject({
      allowed: false,
      reason: 'daily_quota',
    });
  });

  it('no balance, used 100 of 2500 → gated as before', () => {
    expect(freeChat({ creditLimit: 2500, dailyUsed: 6, tokensUsedMonth: 100 })).toMatchObject({
      allowed: false,
      reason: 'daily_quota',
    });
    expect(freeChat({ creditLimit: 2500, dailyUsed: 5, tokensUsedMonth: 100 })).toMatchObject({
      allowed: true,
    });
  });

  it('top-up fully spent but bonus remains → blocked (bonus never bypasses)', () => {
    // top-up 50 spent (used 200 > 50); bonus 100 keeps the monthly pool open (300)
    expect(
      freeChat({ bonus: 100, dailyUsed: 6, tokenBalance: 50, tokensUsedMonth: 200 }),
    ).toMatchObject({ allowed: false, reason: 'daily_quota' });
  });

  it('everything spent → monthly block, reason=credits (had paid pools)', () => {
    expect(freeChat({ dailyUsed: 6, tokenBalance: 50, tokensUsedMonth: 200 })).toMatchObject({
      allowed: false,
      reason: 'credits',
    });
  });

  it('preset/system task (countsTowardQuota=false) is never blocked by the daily quota', () => {
    const r = freeChat({ countsTowardQuota: false, dailyUsed: 9 });
    expect(r.allowed).toBe(true);
    expect(r.dailyQuota).toBeUndefined();
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
    expect(freeChat({ creditLimit: 30, dailyUsed: 6, tokensUsedMonth: 10 })).toMatchObject({
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
    expect(freeChat({ dailyUsed: 9, kind: 'image' })).toMatchObject({ allowed: true });
    expect(freeChat({ dailyUsed: 9, kind: 'video' })).toMatchObject({ allowed: true });
  });
});
