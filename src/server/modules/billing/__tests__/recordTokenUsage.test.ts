import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase, Transaction } from '@/database/type';
import { writeUsageLog } from '@/server/modules/analytics/writeUsageLog';

import { recordTokenUsage } from '../checkUsageLimit';

vi.mock('@/server/modules/analytics/writeUsageLog', () => ({ writeUsageLog: vi.fn() }));
vi.mock('../model-rates', () => ({ calculateCreditsAsync: vi.fn(async () => 10) }));
const { spendCredits } = vi.hoisted(() => ({ spendCredits: vi.fn() }));
vi.mock('@/server/services/billing', () => ({ BillingService: vi.fn().mockImplementation(() => ({ spendCredits })) }));

function fakeDb() {
  // Only transaction is exercised; notification lookup failure is deliberately nonfatal.
  const db = { transaction: vi.fn(async (fn: (tx: Transaction) => Promise<void>) => fn(db as unknown as Transaction)) };
  return db as unknown as LobeChatDatabase & { transaction: typeof db.transaction };
}

beforeEach(() => { vi.clearAllMocks(); spendCredits.mockResolvedValue({ committed: 10 }); vi.mocked(writeUsageLog).mockResolvedValue(undefined); });

describe('recordTokenUsage source-aware atomic debit', () => {
  it('spends and records full funded ordinary plus refund credits in one transaction', async () => {
    const db = fakeDb();
    await recordTokenUsage(db, 'u', 1000, 'model', 500, { provider: 'openrouter', providerRequestId: 'generation' });
    expect(spendCredits).toHaveBeenCalledWith(10, db, { clamp: true });
    expect(writeUsageLog).toHaveBeenCalledWith(db, expect.objectContaining({ creditsCharged: 10, providerRequestId: 'generation' }));
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });
  it('logs actual committed debit, not requested credits, at the boundary', async () => {
    spendCredits.mockResolvedValue({ committed: 3 });
    await recordTokenUsage(fakeDb(), 'u', 1000, 'model', 500);
    expect(writeUsageLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ creditsCharged: 3 }));
  });
  it('records upstream expense even when no credits remain', async () => {
    spendCredits.mockResolvedValue({ committed: 0 });
    await recordTokenUsage(fakeDb(), 'u', 1000, 'model', 500, { providerCostUsd: 0.0151 });
    expect(writeUsageLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ creditsCharged: 0, providerCostUsd: 0.0151 }));
  });
  it('bills cache-only usage and cost-only completions', async () => {
    await recordTokenUsage(fakeDb(), 'u', 0, 'model', 0, { cacheReadTokens: 100 });
    await recordTokenUsage(fakeDb(), 'u', 0, 'model', 0, { providerCostUsd: 0.01 });
    expect(writeUsageLog).toHaveBeenCalledTimes(2);
  });
  it('keeps counter and usage failure inside one rollback boundary', async () => {
    vi.mocked(writeUsageLog).mockRejectedValue(new Error('numeric overflow'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await recordTokenUsage(fakeDb(), 'u', 1000, 'model', 500);
    expect(spy.mock.calls.flat().join(' ')).toContain('numeric overflow');
    expect(spendCredits).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
  it('empty completions do not debit or log', async () => {
    await recordTokenUsage(fakeDb(), 'u', 0, 'model', 0);
    expect(spendCredits).not.toHaveBeenCalled();
    expect(writeUsageLog).not.toHaveBeenCalled();
  });
});
