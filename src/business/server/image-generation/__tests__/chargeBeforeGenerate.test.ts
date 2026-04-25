import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mocks — the SUT pulls these via static imports.
const fetchRateMock = vi.fn();
const checkUsageLimitMock = vi.fn();
const isModelAllowedForPlanAsyncMock = vi.fn();
const calculateCreditsAsyncMock = vi.fn();
const incrementTokensUsedMock = vi.fn();
const getOrResetUserBillingMock = vi.fn();
const getPlanByIdMock = vi.fn();
const getUserPlanSlugMock = vi.fn();

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(async () => makeFakeDb()),
}));

vi.mock('@/server/services/billing/rates-source', () => ({
  fetchRate: fetchRateMock,
}));

vi.mock('@/server/modules/billing/checkUsageLimit', () => ({
  checkUsageLimit: checkUsageLimitMock,
}));

vi.mock('@/server/modules/billing/model-tiers', () => ({
  isModelAllowedForPlanAsync: isModelAllowedForPlanAsyncMock,
}));

vi.mock('@/server/modules/billing/model-rates', () => ({
  calculateCreditsAsync: calculateCreditsAsyncMock,
}));

vi.mock('@/server/services/billing', () => ({
  BillingService: vi.fn().mockImplementation(() => ({
    incrementTokensUsed: incrementTokensUsedMock,
    getOrResetUserBilling: getOrResetUserBillingMock,
    getPlanById: getPlanByIdMock,
    getUserPlanSlug: getUserPlanSlugMock,
  })),
}));

let lastTxInsertReturn: { id: string }[] = [{ id: 'hold-123' }];
function makeFakeDb() {
  const tx: any = {
    insert: () => ({
      values: () => ({
        returning: async () => lastTxInsertReturn,
      }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  };
  const db: any = {
    transaction: async (fn: (t: any) => Promise<any>) => fn(tx),
  };
  return db;
}

beforeEach(() => {
  fetchRateMock.mockReset();
  checkUsageLimitMock.mockReset();
  isModelAllowedForPlanAsyncMock.mockReset();
  calculateCreditsAsyncMock.mockReset();
  incrementTokensUsedMock.mockReset();
  getOrResetUserBillingMock.mockReset();
  getPlanByIdMock.mockReset();
  getUserPlanSlugMock.mockReset();
  lastTxInsertReturn = [{ id: 'hold-123' }];
});

afterEach(() => {
  vi.clearAllMocks();
});

const baseRate = {
  modelId: 'dall-e-3',
  provider: 'openai',
  pricingUnit: 'image' as const,
  inputPer1M: null,
  outputPer1M: null,
  perUnit: 0.04,
  markup: 1.5,
  tierOverride: null,
  isActive: true,
};

describe('image chargeBeforeGenerate — Pkg2 precharge architecture', () => {
  it('rejects when tier-gating fails (free + premium model)', async () => {
    fetchRateMock.mockResolvedValue(baseRate);
    getUserPlanSlugMock.mockResolvedValue('free');
    isModelAllowedForPlanAsyncMock.mockResolvedValue(false);

    const { chargeBeforeGenerate } = await import('../chargeBeforeGenerate');

    await expect(
      chargeBeforeGenerate({
        configForDatabase: { prompt: 'x' },
        generationParams: { prompt: 'x' },
        generationTopicId: 'tp',
        imageNum: 1,
        model: 'sora-1',
        provider: 'openai',
        userId: 'u1',
      } as any),
    ).rejects.toThrow(/не доступна на плане/);

    // Tier-gating must fail before precharge insert
    expect(incrementTokensUsedMock).not.toHaveBeenCalled();
  });

  it('rejects when checkUsageLimit blocks', async () => {
    fetchRateMock.mockResolvedValue(baseRate);
    getUserPlanSlugMock.mockResolvedValue('pro');
    isModelAllowedForPlanAsyncMock.mockResolvedValue(true);
    checkUsageLimitMock.mockResolvedValue({ allowed: false, message: 'cap reached' });

    const { chargeBeforeGenerate } = await import('../chargeBeforeGenerate');
    await expect(
      chargeBeforeGenerate({
        configForDatabase: { prompt: 'x' },
        generationParams: { prompt: 'x' },
        generationTopicId: 'tp',
        imageNum: 1,
        model: 'dall-e-3',
        provider: 'openai',
        userId: 'u1',
      } as any),
    ).rejects.toThrow(/cap reached/);
  });

  it('rejects when monthly cap conditional UPDATE fails (insufficient credits)', async () => {
    fetchRateMock.mockResolvedValue(baseRate);
    getUserPlanSlugMock.mockResolvedValue('pro');
    isModelAllowedForPlanAsyncMock.mockResolvedValue(true);
    checkUsageLimitMock.mockResolvedValue({ allowed: true, creditsRemaining: 9 });
    calculateCreditsAsyncMock.mockResolvedValue(10);
    getOrResetUserBillingMock.mockResolvedValue({ planId: 1, tokenBalance: 0 });
    getPlanByIdMock.mockResolvedValue({ tokenLimit: 5 });
    incrementTokensUsedMock.mockRejectedValue(
      new Error('Insufficient credits — would exceed monthly limit'),
    );

    const { chargeBeforeGenerate } = await import('../chargeBeforeGenerate');
    await expect(
      chargeBeforeGenerate({
        configForDatabase: { prompt: 'x' },
        generationParams: { prompt: 'x' },
        generationTopicId: 'tp',
        imageNum: 1,
        model: 'dall-e-3',
        provider: 'openai',
        userId: 'u1',
      } as any),
    ).rejects.toThrow(/Кредиты закончились/);
  });

  it('inserts hold + atomically increments counter on success (router-compatible undefined return)', async () => {
    fetchRateMock.mockResolvedValue(baseRate);
    getUserPlanSlugMock.mockResolvedValue('pro');
    isModelAllowedForPlanAsyncMock.mockResolvedValue(true);
    checkUsageLimitMock.mockResolvedValue({ allowed: true, creditsRemaining: 999 });
    calculateCreditsAsyncMock.mockResolvedValue(40);
    getOrResetUserBillingMock.mockResolvedValue({ planId: 1, tokenBalance: 100 });
    getPlanByIdMock.mockResolvedValue({ tokenLimit: 1000 });
    incrementTokensUsedMock.mockResolvedValue({ committed: 40 });
    lastTxInsertReturn = [{ id: 'hold-abc' }];

    const { chargeBeforeGenerate } = await import('../chargeBeforeGenerate');
    const r = await chargeBeforeGenerate({
      configForDatabase: { prompt: 'x' },
      generationParams: { prompt: 'x' },
      generationTopicId: 'tp',
      imageNum: 2,
      model: 'dall-e-3',
      provider: 'openai',
      userId: 'u1',
    } as any);

    // Router compatibility: undefined means "proceed with generation".
    // Truthy non-undefined (errorBatch) would short-circuit the request.
    expect(r).toBeUndefined();
    expect(incrementTokensUsedMock).toHaveBeenCalledWith(40, expect.anything(), { limit: 1100 });
  });
});
