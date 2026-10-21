import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chargeAfterGenerate } from '../chargeAfterGenerate';

const { settle, reserve, log, rate, calculate } = vi.hoisted(() => ({
  settle: vi.fn(), reserve: vi.fn(), log: vi.fn(), rate: vi.fn(), calculate: vi.fn(),
}));
const tx = {};
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: async () => ({
  transaction: async (fn: (value: object) => Promise<unknown>) => fn(tx),
  select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }) }),
}) }));
vi.mock('@/server/services/billing', () => ({ BillingService: vi.fn().mockImplementation(() => ({ settleCreditHold: settle, reserveCredits: reserve })) }));
vi.mock('@/server/services/billing/rates-source', () => ({ fetchRate: rate }));
vi.mock('@/server/modules/billing/model-rates', () => ({ calculateCreditsAsync: calculate }));
vi.mock('@/server/modules/analytics/writeUsageLog', () => ({ writeUsageLog: log }));

const params = {
  imageNum: 1, inferenceId: 'prediction-1',
  metadata: { asyncTaskId: 'task', generationBatchId: 'batch', modelId: 'image-model' },
  prechargeResult: { amount: 10, holdId: 'hold' }, provider: 'wavespeed', userId: 'user',
};
beforeEach(() => {
  vi.clearAllMocks();
  rate.mockResolvedValue({ modelId: 'image-model', pricingUnit: 'image' });
  calculate.mockResolvedValue(7);
  settle.mockResolvedValue({ settled: true, committed: 7 });
  reserve.mockResolvedValue({ id: 'legacy' });
});
describe('source-aware image settlement', () => {
  it.each([7, 15])('settles full actual %s, not a counter delta', async (credits) => {
    calculate.mockResolvedValue(credits);
    settle.mockResolvedValue({ settled: true, committed: credits });
    await chargeAfterGenerate(params);
    expect(settle).toHaveBeenCalledWith('hold', credits, tx);
    expect(log).toHaveBeenCalledWith(tx, expect.objectContaining({ creditsCharged: credits, providerRequestId: 'prediction-1', providerCostUsd: undefined }));
  });
  it('records every batch image against its own independently settled hold', async () => {
    const completed = new Set<string>();
    settle.mockImplementation(async (id: string) => {
      if (completed.has(id)) return { settled: false, committed: 0 };
      completed.add(id);
      return { settled: true, committed: 7 };
    });
    for (const holdId of ['image-1', 'image-2', 'image-3']) {
      await chargeAfterGenerate({ ...params, prechargeResult: { amount: 7, holdId } });
    }
    expect(log).toHaveBeenCalledTimes(3);
    expect(completed.size).toBe(3);
  });
  it('restores original funding on failure', async () => {
    await chargeAfterGenerate({ ...params, isError: true });
    expect(settle).toHaveBeenCalledWith('hold', 0, tx);
    expect(log).not.toHaveBeenCalled();
  });
  it('does not log duplicate completion', async () => {
    settle.mockResolvedValue({ settled: false, committed: 0 });
    await chargeAfterGenerate(params);
    expect(log).not.toHaveBeenCalled();
  });
  it('records committed funding rather than an unfunded computed charge', async () => {
    settle.mockResolvedValue({ settled: true, committed: 2 });
    await chargeAfterGenerate(params);
    expect(log).toHaveBeenCalledWith(tx, expect.objectContaining({ creditsCharged: 2 }));
  });
  it('preserves verified zero renderer expense', async () => {
    await chargeAfterGenerate({ ...params, served: { provider: 'llm-router', providerCostUsd: 0 } });
    expect(log).toHaveBeenCalledWith(tx, expect.objectContaining({ providerCostUsd: 0 }));
  });
  it('reserves legacy unheld usage before settlement', async () => {
    await chargeAfterGenerate({ ...params, prechargeResult: undefined });
    expect(reserve).toHaveBeenCalledWith(7, 'image-gen', 'task', tx);
    expect(settle).toHaveBeenCalledWith('legacy', 7, tx);
  });
});
