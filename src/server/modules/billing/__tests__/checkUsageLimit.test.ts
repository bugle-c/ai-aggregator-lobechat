import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkUsageLimit } from '../checkUsageLimit';

// Mock the BillingService so we can control the failure / success path.
const getOrResetUserBillingMock = vi.fn();
const getPlanByIdMock = vi.fn();
vi.mock('@/server/services/billing', () => ({
  BillingService: vi.fn().mockImplementation(() => ({
    getOrResetUserBilling: getOrResetUserBillingMock,
    getPlanById: getPlanByIdMock,
  })),
}));

// Avoid touching tier-classification / model-rates network paths.
vi.mock('../model-tiers', () => ({
  classifyModelTierAsync: vi.fn(async () => 'cheap'),
  getModelsByTierAsync: vi.fn(async () => []),
}));

// Drizzle-like fake db: select(...).from(...).where(...) returns [{ used: 0 }]
function makeFakeDb() {
  const chain = {
    from: () => chain,
    where: () => Promise.resolve([{ used: 0 }]),
  };
  return {
    select: () => chain,
  } as any;
}

// Fake db whose count(*) query (daily-quota.ts) resolves to `count`; records calls.
function makeCountDb(count: number) {
  const select = vi.fn(() => ({
    from: () => ({ where: () => Promise.resolve([{ count }]) }),
  }));
  return { db: { select } as any, select };
}

beforeEach(() => {
  getOrResetUserBillingMock.mockReset();
  getPlanByIdMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('checkUsageLimit fail-closed', () => {
  it('returns allowed=false with retry message when getOrResetUserBilling throws', async () => {
    getOrResetUserBillingMock.mockRejectedValueOnce(new Error('PG down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await checkUsageLimit(makeFakeDb(), 'user-1', 'claude-opus-4-7');

    expect(result.allowed).toBe(false);
    expect(result.creditsRemaining).toBe(0);
    expect(result.message).toMatch(/недоступен/i);
    expect(errorSpy).toHaveBeenCalled();
    const logged = errorSpy.mock.calls.flat().join(' ');
    expect(logged).toMatch(/failing closed/i);

    errorSpy.mockRestore();
  });

  it('returns allowed=false even when modelId is undefined (still fail-closed)', async () => {
    getOrResetUserBillingMock.mockRejectedValueOnce(new Error('connection refused'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await checkUsageLimit(makeFakeDb(), 'user-2');

    expect(result.allowed).toBe(false);
    expect(result.message).toMatch(/недоступен/i);

    errorSpy.mockRestore();
  });

  it('does NOT fail closed on the happy path', async () => {
    getOrResetUserBillingMock.mockResolvedValueOnce({
      planId: 1,
      tokenBalance: 0,
      tokensUsedMonth: 0,
    });
    getPlanByIdMock.mockResolvedValueOnce({
      slug: 'free',
      tokenLimit: 50,
      dailyCreditLimit: null,
    });

    const result = await checkUsageLimit(makeFakeDb(), 'user-3', 'gpt-5-nano');
    expect(result.allowed).toBe(true);
  });

  it('ignores legacy dailyCreditLimit and only enforces monthly credits', async () => {
    getOrResetUserBillingMock.mockResolvedValueOnce({
      planId: 2,
      tokenBalance: 0,
      tokensUsedMonth: 10,
    });
    getPlanByIdMock.mockResolvedValueOnce({
      slug: 'basic',
      tokenLimit: 50,
      dailyCreditLimit: 1,
    });
    const dbThatWouldFailIfDailyQueried = {
      select: vi.fn(() => {
        throw new Error('daily cap query should not run');
      }),
    } as any;

    const result = await checkUsageLimit(dbThatWouldFailIfDailyQueried, 'user-4', 'gpt-5-nano');

    expect(result.allowed).toBe(true);
    expect(result.creditsRemaining).toBe(40);
  });
});

describe('checkUsageLimit — EXP-003 free daily message quota', () => {
  const freeBilling = { bonusBalance: 0, planId: 1, tokenBalance: 0, tokensUsedMonth: 6 };
  const freePlan = { dailyCreditLimit: null, slug: 'free', tokenLimit: 150 };

  it("counts today's user messages (incl. current) and blocks the 6th with reason=daily_quota", async () => {
    getOrResetUserBillingMock.mockResolvedValueOnce(freeBilling);
    getPlanByIdMock.mockResolvedValueOnce(freePlan);
    const { db, select } = makeCountDb(6);

    const result = await checkUsageLimit(db, 'user-5', 'gpt-5-mini', { kind: 'chat' });

    expect(select).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ allowed: false, dailyRemaining: 0, reason: 'daily_quota' });
    expect(result.message).toContain('Лимит на сегодня исчерпан');
  });

  it('allows the 5th message (5 persisted) and reports 0 left today', async () => {
    getOrResetUserBillingMock.mockResolvedValueOnce(freeBilling);
    getPlanByIdMock.mockResolvedValueOnce(freePlan);
    const { db } = makeCountDb(5);

    const result = await checkUsageLimit(db, 'user-6', 'gpt-5-mini');

    expect(result).toMatchObject({ allowed: true, dailyQuota: 5, dailyRemaining: 0 });
  });

  it('preset task (countsTowardQuota=false) skips the count and is never blocked', async () => {
    getOrResetUserBillingMock.mockResolvedValueOnce(freeBilling);
    getPlanByIdMock.mockResolvedValueOnce(freePlan);
    const { db, select } = makeCountDb(99);

    const result = await checkUsageLimit(db, 'user-6b', 'gpt-5-mini', {
      countsTowardQuota: false,
      kind: 'chat',
    });

    expect(select).not.toHaveBeenCalled();
    expect(result.allowed).toBe(true);
  });

  it('does not run the daily count for image/video kinds', async () => {
    getOrResetUserBillingMock.mockResolvedValueOnce(freeBilling);
    getPlanByIdMock.mockResolvedValueOnce(freePlan);
    const { db, select } = makeCountDb(99);

    const result = await checkUsageLimit(db, 'user-7', 'gpt-image-1', { kind: 'image' });

    expect(select).not.toHaveBeenCalled();
    expect(result.allowed).toBe(true);
  });

  it('does not run the daily count for paid plans', async () => {
    getOrResetUserBillingMock.mockResolvedValueOnce({ ...freeBilling, planId: 2 });
    getPlanByIdMock.mockResolvedValueOnce({ dailyCreditLimit: null, slug: 'basic', tokenLimit: 2500 });
    const { db, select } = makeCountDb(99);

    const result = await checkUsageLimit(db, 'user-8', 'gpt-5-mini');

    expect(select).not.toHaveBeenCalled();
    expect(result.allowed).toBe(true);
  });

  it('monthly safety cap → reason=monthly_cap for a free user without paid pools', async () => {
    getOrResetUserBillingMock.mockResolvedValueOnce({ ...freeBilling, tokensUsedMonth: 150 });
    getPlanByIdMock.mockResolvedValueOnce(freePlan);
    const { db } = makeCountDb(0);

    const result = await checkUsageLimit(db, 'user-9', 'gpt-5-mini');

    expect(result).toMatchObject({ allowed: false, reason: 'monthly_cap' });
    expect(result.message).toContain('Кредиты закончились');
  });
});
