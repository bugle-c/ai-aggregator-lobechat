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
});
