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
let nextSelectRows: any[] = [];
function makeFakeDb() {
  const tx: any = {
    update: () => ({ set: () => ({ where: updateSetWhereSpy }) }),
  };
  const db: any = {
    transaction: async (fn: (t: any) => Promise<any>) => fn(tx),
    update: () => ({ set: () => ({ where: updateSetWhereSpy }) }),
    // findOldestActiveHold lookup
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => nextSelectRows,
          }),
        }),
      }),
    }),
  };
  return db;
}

beforeEach(() => {
  fetchRateMock.mockReset();
  calculateCreditsAsyncMock.mockReset();
  incrementTokensUsedMock.mockReset().mockResolvedValue({ committed: 0 });
  writeUsageLogMock.mockReset().mockResolvedValue(undefined);
  updateSetWhereSpy.mockClear();
  nextSelectRows = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

const imageRate = {
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

describe('image chargeAfterGenerate — reconcile against hold', () => {
  it('reconciles when actual < held (refund partial)', async () => {
    fetchRateMock.mockResolvedValue(imageRate);
    calculateCreditsAsyncMock.mockResolvedValue(7); // actual 7
    const { chargeAfterGenerate } = await import('../chargeAfterGenerate');

    await chargeAfterGenerate({
      imageNum: 1,
      metadata: { asyncTaskId: 'a1', generationBatchId: 'b1', modelId: 'dall-e-3' },
      provider: 'openai',
      userId: 'u1',
      prechargeResult: { amount: 10, holdId: 'h1' }, // held 10
    } as any);

    // diff = 7 - 10 = -3, so partial refund of 3 credits
    expect(incrementTokensUsedMock).toHaveBeenCalledWith(-3, expect.anything());
    expect(updateSetWhereSpy).toHaveBeenCalled();
    expect(writeUsageLogMock).toHaveBeenCalled();
  });

  it('reconciles when actual > held (charge extra)', async () => {
    fetchRateMock.mockResolvedValue(imageRate);
    calculateCreditsAsyncMock.mockResolvedValue(15); // actual 15
    const { chargeAfterGenerate } = await import('../chargeAfterGenerate');

    await chargeAfterGenerate({
      imageNum: 1,
      metadata: { asyncTaskId: 'a1', generationBatchId: 'b1', modelId: 'dall-e-3' },
      provider: 'openai',
      userId: 'u1',
      prechargeResult: { amount: 10, holdId: 'h1' },
    } as any);

    // diff = 15 - 10 = +5
    expect(incrementTokensUsedMock).toHaveBeenCalledWith(5, expect.anything());
    expect(updateSetWhereSpy).toHaveBeenCalled();
  });

  it('refunds full hold on isError', async () => {
    const { chargeAfterGenerate } = await import('../chargeAfterGenerate');

    await chargeAfterGenerate({
      isError: true,
      metadata: { asyncTaskId: 'a1', generationBatchId: 'b1', modelId: 'dall-e-3' },
      provider: 'openai',
      userId: 'u1',
      prechargeResult: { amount: 10, holdId: 'h1' },
    } as any);

    expect(incrementTokensUsedMock).toHaveBeenCalledWith(-10, expect.anything());
    expect(writeUsageLogMock).not.toHaveBeenCalled();
  });

  it('legacy path: no precharge AND no active hold → just commit actual cost', async () => {
    fetchRateMock.mockResolvedValue(imageRate);
    calculateCreditsAsyncMock.mockResolvedValue(8);
    nextSelectRows = []; // no active hold
    const { chargeAfterGenerate } = await import('../chargeAfterGenerate');

    await chargeAfterGenerate({
      imageNum: 1,
      metadata: { asyncTaskId: 'a1', generationBatchId: 'b1', modelId: 'dall-e-3' },
      provider: 'openai',
      userId: 'u1',
    } as any);

    expect(incrementTokensUsedMock).toHaveBeenCalledWith(8, expect.anything());
    expect(writeUsageLogMock).toHaveBeenCalled();
  });

  it('FIFO fallback: no prechargeResult passed but active hold exists → reconciles against it', async () => {
    fetchRateMock.mockResolvedValue(imageRate);
    calculateCreditsAsyncMock.mockResolvedValue(7);
    nextSelectRows = [{ id: 'h-fifo', amount: 10 }];
    const { chargeAfterGenerate } = await import('../chargeAfterGenerate');

    await chargeAfterGenerate({
      imageNum: 1,
      metadata: { asyncTaskId: 'a1', generationBatchId: 'b1', modelId: 'dall-e-3' },
      provider: 'openai',
      userId: 'u1',
    } as any);

    // diff = 7 - 10 = -3 (partial refund)
    expect(incrementTokensUsedMock).toHaveBeenCalledWith(-3, expect.anything());
    expect(updateSetWhereSpy).toHaveBeenCalled();
  });
});
