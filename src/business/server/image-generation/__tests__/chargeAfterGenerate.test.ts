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
// Rows the release-once UPDATE … RETURNING hands back: [] = hold already released.
let nextReleaseRows: any[] = [{ id: 'hold' }];
const whereWithReturning = (...args: any[]) => {
  void updateSetWhereSpy(...(args as []));
  return { returning: async () => nextReleaseRows };
};
let nextSelectRows: any[] = [];
let selectCalls = 0;
function makeFakeDb() {
  const tx: any = {
    update: () => ({ set: () => ({ where: whereWithReturning }) }),
  };
  const db: any = {
    transaction: async (fn: (t: any) => Promise<any>) => fn(tx),
    update: () => ({ set: () => ({ where: whereWithReturning }) }),
    // findOldestActiveHold lookup
    select: () => {
      selectCalls += 1;
      return {
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: async () => nextSelectRows,
            }),
          }),
        }),
      };
    },
  };
  return db;
}

beforeEach(() => {
  fetchRateMock.mockReset();
  calculateCreditsAsyncMock.mockReset();
  incrementTokensUsedMock.mockReset().mockResolvedValue({ committed: 0 });
  writeUsageLogMock.mockReset().mockResolvedValue(undefined);
  updateSetWhereSpy.mockClear();
  nextReleaseRows = [{ id: 'hold' }];
  nextSelectRows = [];
  selectCalls = 0;
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
  markupOverride: null,
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

  it('newer task fails while an older one is pending: refunds ITS OWN share, never the oldest hold', async () => {
    const { chargeAfterGenerate } = await import('../chargeAfterGenerate');
    // Older, still-running generation A holds 127 and would be the FIFO pick.
    nextSelectRows = [{ id: 'hold-A', amount: 127 }];

    await chargeAfterGenerate({
      isError: true,
      metadata: { asyncTaskId: 'task-B', generationBatchId: 'b2', modelId: 'dall-e-3' },
      prechargeResult: { amount: 127, holdId: 'hold-B' },
      provider: 'wavespeed',
      userId: 'u1',
    });

    expect(selectCalls).toBe(0); // no oldest-hold guessing when the hold is known
    expect(incrementTokensUsedMock).toHaveBeenCalledWith(-127, expect.anything());
    expect(updateSetWhereSpy).toHaveBeenCalledTimes(1); // exactly one hold released
  });

  it('a second isError for the same hold refunds nothing (release-once gate)', async () => {
    const { chargeAfterGenerate } = await import('../chargeAfterGenerate');
    nextReleaseRows = []; // the hold was already released by the first finisher
    await chargeAfterGenerate({
      isError: true,
      metadata: { asyncTaskId: 't', generationBatchId: 'b', modelId: 'dall-e-3' },
      prechargeResult: { amount: 127, holdId: 'hold-B' },
      provider: 'wavespeed',
      userId: 'u1',
    });
    expect(incrementTokensUsedMock).not.toHaveBeenCalled();
  });
});
