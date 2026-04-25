import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchRateMock = vi.fn();
const calculateCreditsAsyncMock = vi.fn();
const incrementTokensUsedMock = vi.fn();
const writeUsageLogMock = vi.fn();

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(async () => makeFakeDb()),
}));

vi.mock('@/server/services/billing/rates-source', () => ({
  fetchRate: fetchRateMock,
}));

vi.mock('@/server/modules/billing/model-rates', () => ({
  calculateCreditsAsync: calculateCreditsAsyncMock,
}));

vi.mock('@/server/modules/analytics/writeUsageLog', () => ({
  writeUsageLog: writeUsageLogMock,
}));

vi.mock('@/server/services/billing', () => ({
  BillingService: vi.fn().mockImplementation(() => ({
    incrementTokensUsed: incrementTokensUsedMock,
  })),
}));

const updateSetWhereSpy = vi.fn(async () => undefined);
function makeFakeDb() {
  const tx: any = {
    update: () => ({ set: () => ({ where: updateSetWhereSpy }) }),
  };
  const db: any = {
    transaction: async (fn: (t: any) => Promise<any>) => fn(tx),
  };
  return db;
}

beforeEach(() => {
  fetchRateMock.mockReset();
  calculateCreditsAsyncMock.mockReset();
  incrementTokensUsedMock.mockReset().mockResolvedValue({ committed: 0 });
  writeUsageLogMock.mockReset().mockResolvedValue(undefined);
  updateSetWhereSpy.mockClear();
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

describe('video chargeAfterGenerate — reconcile / refund', () => {
  it('refunds full hold on isError', async () => {
    const { chargeAfterGenerate } = await import('../chargeAfterGenerate');

    await chargeAfterGenerate({
      isError: true,
      metadata: { asyncTaskId: 'a1', generationBatchId: 'b1', modelId: 'sora-1' },
      model: 'sora-1',
      provider: 'openai',
      userId: 'u1',
      prechargeResult: { amount: 60, holdId: 'h1' },
    } as any);

    expect(incrementTokensUsedMock).toHaveBeenCalledWith(-60, expect.anything());
    expect(writeUsageLogMock).not.toHaveBeenCalled();
  });

  it('reconciles: actual < held → partial refund of diff', async () => {
    fetchRateMock.mockResolvedValue(videoRate);
    calculateCreditsAsyncMock.mockResolvedValue(40); // actual cost
    const { chargeAfterGenerate } = await import('../chargeAfterGenerate');

    await chargeAfterGenerate({
      metadata: { asyncTaskId: 'a1', generationBatchId: 'b1', modelId: 'sora-1' },
      model: 'sora-1',
      provider: 'openai',
      userId: 'u1',
      usage: { completionTokens: 0, totalTokens: 0, durationSeconds: 5 },
      prechargeResult: { amount: 60, holdId: 'h1' },
    } as any);

    // diff = 40 - 60 = -20
    expect(incrementTokensUsedMock).toHaveBeenCalledWith(-20, expect.anything());
    expect(updateSetWhereSpy).toHaveBeenCalled();
    expect(writeUsageLogMock).toHaveBeenCalled();
  });

  it('reconciles: actual > held → charge extra', async () => {
    fetchRateMock.mockResolvedValue(videoRate);
    calculateCreditsAsyncMock.mockResolvedValue(80);
    const { chargeAfterGenerate } = await import('../chargeAfterGenerate');

    await chargeAfterGenerate({
      metadata: { asyncTaskId: 'a1', generationBatchId: 'b1', modelId: 'sora-1' },
      model: 'sora-1',
      provider: 'openai',
      userId: 'u1',
      usage: { completionTokens: 0, totalTokens: 0, durationSeconds: 10 },
      prechargeResult: { amount: 60, holdId: 'h1' },
    } as any);

    expect(incrementTokensUsedMock).toHaveBeenCalledWith(20, expect.anything());
  });

  it('skip + release hold when no durationSeconds', async () => {
    const { chargeAfterGenerate } = await import('../chargeAfterGenerate');

    await chargeAfterGenerate({
      metadata: { asyncTaskId: 'a1', generationBatchId: 'b1', modelId: 'sora-1' },
      model: 'sora-1',
      provider: 'openai',
      userId: 'u1',
      usage: { completionTokens: 0, totalTokens: 0, durationSeconds: 0 },
      prechargeResult: { amount: 60, holdId: 'h1' },
    } as any);

    // No charge, but the hold MUST be released and refunded — otherwise
    // the user is permanently down 60 credits with nothing in usage_logs.
    expect(incrementTokensUsedMock).toHaveBeenCalledWith(-60, expect.anything());
    expect(updateSetWhereSpy).toHaveBeenCalled();
    expect(writeUsageLogMock).not.toHaveBeenCalled();
  });

  it('legacy path (no precharge) — commit actual cost', async () => {
    fetchRateMock.mockResolvedValue(videoRate);
    calculateCreditsAsyncMock.mockResolvedValue(45);
    const { chargeAfterGenerate } = await import('../chargeAfterGenerate');

    await chargeAfterGenerate({
      metadata: { asyncTaskId: 'a1', generationBatchId: 'b1', modelId: 'sora-1' },
      model: 'sora-1',
      provider: 'openai',
      userId: 'u1',
      usage: { completionTokens: 0, totalTokens: 0, durationSeconds: 6 },
    } as any);

    expect(incrementTokensUsedMock).toHaveBeenCalledWith(45, expect.anything());
    expect(writeUsageLogMock).toHaveBeenCalled();
  });
});
