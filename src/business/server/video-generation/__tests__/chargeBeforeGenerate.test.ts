import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

let lastTxInsertReturn: { id: string }[] = [{ id: 'hold-vid' }];
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
  lastTxInsertReturn = [{ id: 'hold-vid' }];
});

afterEach(() => {
  vi.clearAllMocks();
});

const videoRate = {
  modelId: 'sora-1',
  provider: 'openai',
  pricingUnit: 'second' as const,
  inputPer1M: null,
  outputPer1M: null,
  perUnit: 0.5,
  markup: 1.5,
  tierOverride: 'premium' as const,
  isActive: true,
};

describe('video chargeBeforeGenerate — Pkg2 precharge architecture', () => {
  it('rejects when tier-gating fails (free + Sora premium)', async () => {
    fetchRateMock.mockResolvedValue(videoRate);
    getUserPlanSlugMock.mockResolvedValue('free');
    isModelAllowedForPlanAsyncMock.mockResolvedValue(false);

    const { chargeBeforeGenerate } = await import('../chargeBeforeGenerate');

    await expect(
      chargeBeforeGenerate({
        generationTopicId: 'tp',
        model: 'sora-1',
        provider: 'openai',
        userId: 'u1',
        params: { prompt: 'x', duration: 5 },
      } as any),
    ).rejects.toThrow(/не доступна на плане/);
  });

  it('rejects when monthly cap conditional UPDATE fails', async () => {
    fetchRateMock.mockResolvedValue(videoRate);
    getUserPlanSlugMock.mockResolvedValue('pro_max');
    isModelAllowedForPlanAsyncMock.mockResolvedValue(true);
    checkUsageLimitMock.mockResolvedValue({ allowed: true });
    calculateCreditsAsyncMock.mockResolvedValue(500);
    getOrResetUserBillingMock.mockResolvedValue({ planId: 1, tokenBalance: 0 });
    getPlanByIdMock.mockResolvedValue({ tokenLimit: 100 });
    incrementTokensUsedMock.mockRejectedValue(
      new Error('Insufficient credits — would exceed monthly limit'),
    );

    const { chargeBeforeGenerate } = await import('../chargeBeforeGenerate');

    await expect(
      chargeBeforeGenerate({
        generationTopicId: 'tp',
        model: 'sora-1',
        provider: 'openai',
        userId: 'u1',
        params: { prompt: 'x' },
      } as any),
    ).rejects.toThrow(/Кредиты закончились/);
  });

  it('returns prechargeResult on success with worst-case credits', async () => {
    fetchRateMock.mockResolvedValue(videoRate);
    getUserPlanSlugMock.mockResolvedValue('pro_max');
    isModelAllowedForPlanAsyncMock.mockResolvedValue(true);
    checkUsageLimitMock.mockResolvedValue({ allowed: true });
    calculateCreditsAsyncMock.mockResolvedValue(60);
    getOrResetUserBillingMock.mockResolvedValue({ planId: 1, tokenBalance: 200 });
    getPlanByIdMock.mockResolvedValue({ tokenLimit: 5000 });
    incrementTokensUsedMock.mockResolvedValue({ committed: 60 });
    lastTxInsertReturn = [{ id: 'h-vid-1' }];

    const { chargeBeforeGenerate } = await import('../chargeBeforeGenerate');
    const r = await chargeBeforeGenerate({
      generationTopicId: 'tp',
      model: 'sora-1',
      provider: 'openai',
      userId: 'u1',
      params: { prompt: 'x', duration: 8 },
    } as any);

    expect(r.prechargeResult).toEqual({ amount: 60, holdId: 'h-vid-1' });
    expect(incrementTokensUsedMock).toHaveBeenCalledWith(60, expect.anything(), { limit: 5200 });
  });
});
