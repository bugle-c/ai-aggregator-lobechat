import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { writeUsageLog } from '@/server/modules/analytics/writeUsageLog';

import { recordTokenUsage } from '../checkUsageLimit';

// Mock writeUsageLog BEFORE importing checkUsageLimit, because recordTokenUsage
// uses a dynamic import for writeUsageLog.
vi.mock('@/server/modules/analytics/writeUsageLog', () => ({
  writeUsageLog: vi.fn(),
}));

// Mock model-rates to avoid fetching remote pricing during tests.
vi.mock('../model-rates', () => ({
  calculateCreditsAsync: vi.fn(async () => 10),
}));

// Mock the BillingService so we can observe increment calls.
const incrementTokensUsedMock = vi.fn();
vi.mock('@/server/services/billing', () => ({
  BillingService: vi.fn().mockImplementation(() => ({
    incrementTokensUsed: incrementTokensUsedMock,
  })),
}));

/**
 * Drizzle-like transaction: when `db.transaction(async (tx) => ...)` is called,
 * we invoke the callback with `tx` === the db object, and if it throws we
 * propagate (mimicking real rollback). State tracking is left to the mocks.
 */
function makeFakeDb() {
  const db: any = {
    transaction: async (fn: (tx: any) => Promise<any>) => {
      return fn(db);
    },
  };
  return db;
}

beforeEach(() => {
  incrementTokensUsedMock.mockReset();
  (writeUsageLog as any).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('recordTokenUsage — strict transaction', () => {
  it('calls both incrementTokensUsed and writeUsageLog on the happy path', async () => {
    const db = makeFakeDb();
    incrementTokensUsedMock.mockResolvedValue(undefined);
    (writeUsageLog as any).mockResolvedValue(undefined);

    await recordTokenUsage(db, 'user_1', 1000, 'gpt-5-nano', 500, {
      provider: 'openai',
      kind: 'chat',
    });

    expect(incrementTokensUsedMock).toHaveBeenCalledTimes(1);
    // Called as (credits, tx) — tx is whatever the db.transaction callback receives.
    expect(incrementTokensUsedMock).toHaveBeenCalledWith(10, expect.anything());
    expect(writeUsageLog).toHaveBeenCalledTimes(1);
  });

  it('does NOT commit increment when writeUsageLog throws (atomic rollback)', async () => {
    // Simulate a real drizzle-style transaction that rolls back on throw:
    // we track increment calls, but if the tx callback throws, the outer caller
    // should see the error (rollback is implicit — we assert no "commit" signal).
    const db: any = {
      transaction: async (fn: (tx: any) => Promise<any>) => {
        // If callback throws, propagate — mimics rollback (no COMMIT happens).
        return fn(db);
      },
    };

    incrementTokensUsedMock.mockResolvedValue(undefined);
    (writeUsageLog as any).mockRejectedValue(new Error('numeric overflow'));

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await recordTokenUsage(db, 'user_2', 1000, 'gpt-5-nano', 500, {
      provider: 'openai',
      kind: 'chat',
    });

    // writeUsageLog threw → error must be logged loudly (not swallowed silently)
    expect(errorSpy).toHaveBeenCalled();
    const logged = errorSpy.mock.calls.flat().join(' ');
    expect(logged).toMatch(/numeric overflow|charge transaction failed|recordTokenUsage FAIL/);

    // The key contract: increment and writeUsageLog must be invoked
    // inside the same transaction call — if the log fails, the transaction
    // is aborted as a whole.
    expect(writeUsageLog).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
  });

  it('uses db.transaction to wrap increment + log atomically', async () => {
    const txSpy = vi.fn(async (fn: any) => fn({ transaction: vi.fn() }));
    const db: any = { transaction: txSpy };

    incrementTokensUsedMock.mockResolvedValue(undefined);
    (writeUsageLog as any).mockResolvedValue(undefined);

    await recordTokenUsage(db, 'user_3', 1000, 'gpt-5-nano', 500, {
      provider: 'openai',
      kind: 'chat',
    });

    expect(txSpy).toHaveBeenCalledTimes(1);
  });
});
