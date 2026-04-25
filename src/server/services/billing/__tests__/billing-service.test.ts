import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BillingService } from '../index';

vi.mock('../plans-source', () => ({
  fetchActivePlans: vi.fn(),
  fetchPlanById: vi.fn(),
}));

interface ExecCall {
  params: unknown[];
  query: string;
}

function makeFakeDb() {
  const execCalls: ExecCall[] = [];
  const updateCalls: any[] = [];
  let nextExecRowCount: number | null = 1;
  let nextSelectRows: any[] = [];

  const fakeUpdate = () => {
    return {
      set: () => ({
        where: async (_w: any) => {
          updateCalls.push({ kind: 'plain' });
          return undefined;
        },
      }),
    };
  };

  const db: any = {
    execute: async (query: any) => {
      // Drizzle's `sql` template tag wraps {queryChunks, ...}. We just record
      // and return rowCount. Tests assert behaviour via _setExec / _execCalls.
      execCalls.push({ query: String(query?.queryChunks ?? query), params: [] });
      return { rowCount: nextExecRowCount };
    },
    update: fakeUpdate,
    insert: () => ({
      values: () => ({
        onConflictDoNothing: async () => undefined,
        returning: async () => [],
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => nextSelectRows,
        }),
      }),
    }),
    transaction: async (fn: any) => fn(db),
    // test helpers
    _setExecRowCount: (n: number | null) => {
      nextExecRowCount = n;
    },
    _setSelectRows: (rows: any[]) => {
      nextSelectRows = rows;
    },
    _execCalls: () => execCalls,
    _updateCalls: () => updateCalls,
  };
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('BillingService.incrementTokensUsed — atomic limit guard (C1)', () => {
  it('runs a conditional UPDATE when limit option is present', async () => {
    const db = makeFakeDb();
    db._setExecRowCount(1);
    const svc = new BillingService(db, 'u1');

    const r = await svc.incrementTokensUsed(50, undefined as any, { limit: 100 });

    expect(r.committed).toBe(50);
    expect(db._execCalls().length).toBe(1);
    // Plain (non-conditional) update is NOT used.
    expect(db._updateCalls().length).toBe(0);
  });

  it('throws when conditional UPDATE returns 0 rows (would overshoot)', async () => {
    const db = makeFakeDb();
    db._setExecRowCount(0);
    const svc = new BillingService(db, 'u1');

    await expect(svc.incrementTokensUsed(50, undefined as any, { limit: 10 })).rejects.toThrow(
      /Insufficient credits/,
    );
  });

  it('falls back to plain UPDATE when no limit option (legacy callers)', async () => {
    const db = makeFakeDb();
    const svc = new BillingService(db, 'u1');

    await svc.incrementTokensUsed(10);

    expect(db._execCalls().length).toBe(0);
    expect(db._updateCalls().length).toBe(1);
  });

  it('uses plain UPDATE for negative deltas (refunds bypass cap check)', async () => {
    const db = makeFakeDb();
    const svc = new BillingService(db, 'u1');

    // Even with limit set, a refund (-10) cannot overshoot a positive cap.
    await svc.incrementTokensUsed(-10, undefined as any, { limit: 100 });

    expect(db._execCalls().length).toBe(0);
    expect(db._updateCalls().length).toBe(1);
  });
});

describe('BillingService.getOrResetUserBilling — atomic monthly reset (H1)', () => {
  it('issues a conditional UPDATE that only matches stale month_start', async () => {
    const db = makeFakeDb();
    db._setExecRowCount(1);
    db._setSelectRows([
      {
        userId: 'u1',
        planId: 1,
        tokenBalance: 0,
        tokensUsedMonth: 0,
        monthStart: new Date(),
      },
    ]);

    const svc = new BillingService(db, 'u1');
    const r = await svc.getOrResetUserBilling();

    // Reset is one execute() call (the conditional UPDATE). Two calls would
    // hint at non-atomic read-then-write — the bug we're guarding against.
    expect(db._execCalls().length).toBe(1);
    expect(r).toBeDefined();
  });

  it('returns the (possibly already reset) row from a fresh SELECT', async () => {
    const db = makeFakeDb();
    db._setExecRowCount(0); // no rows updated → already current
    db._setSelectRows([
      {
        userId: 'u1',
        planId: 1,
        tokenBalance: 0,
        tokensUsedMonth: 100,
        monthStart: new Date(),
      },
    ]);

    const svc = new BillingService(db, 'u1');
    const r = await svc.getOrResetUserBilling();
    expect(r.tokensUsedMonth).toBe(100);
  });
});
