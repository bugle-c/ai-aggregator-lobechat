import { PgDialect } from 'drizzle-orm/pg-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BillingService, usagePeriodNeedsReset } from '../index';

vi.mock('../plans-source', () => ({
  fetchActivePlans: vi.fn(),
  fetchPlanById: vi.fn(),
}));

interface ExecCall {
  params: unknown[];
  query: string;
  /** The drizzle `sql` object as passed to db.execute — render with PgDialect. */
  raw: any;
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
      execCalls.push({ query: String(query?.queryChunks ?? query), params: [], raw: query });
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

// ---------------------------------------------------------------------------
// Lazy usage-period reset — free = calendar month, paid = 30-day cycle.
// Guards the double reset: updatePlan sets month_start = now() on a paid
// activation, so the lazy path must NOT fire again on the 1st for paid plans.
// ---------------------------------------------------------------------------
const OCT_1 = new Date('2026-10-01T10:00:00Z');
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(OCT_1.getTime() - n * DAY);

const renderSql = (raw: any) => new PgDialect().sqlToQuery(raw);

describe('usagePeriodNeedsReset', () => {
  it('paid plan with month_start 3 days ago (Sept 28) does NOT reset on Oct 1', () => {
    expect(usagePeriodNeedsReset({ monthStart: daysAgo(3), now: OCT_1, planId: 2 })).toBe(false);
  });

  it('paid plan resets once the 30-day cycle has elapsed', () => {
    expect(usagePeriodNeedsReset({ monthStart: daysAgo(31), now: OCT_1, planId: 2 })).toBe(true);
    expect(usagePeriodNeedsReset({ monthStart: daysAgo(29), now: OCT_1, planId: 2 })).toBe(false);
  });

  it('free plan with month_start 3 days ago (Sept 28) DOES reset on Oct 1', () => {
    expect(usagePeriodNeedsReset({ monthStart: daysAgo(3), now: OCT_1, planId: 1 })).toBe(true);
  });

  it('free plan already in the current calendar month is left alone', () => {
    expect(
      usagePeriodNeedsReset({
        monthStart: new Date('2026-10-01T00:00:00Z'),
        now: OCT_1,
        planId: 1,
      }),
    ).toBe(false);
  });
});

describe('BillingService.getOrResetUserBilling — period-based lazy reset', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(OCT_1);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('paid user with month_start = Sept 28 gets no UPDATE on Oct 1 and keeps the counter', async () => {
    const db = makeFakeDb();
    const row = { userId: 'u1', planId: 2, monthStart: daysAgo(3), tokensUsedMonth: 4200 };
    db._setSelectRows([row]);

    const billing = await new BillingService(db, 'u1').getOrResetUserBilling();

    expect(db._execCalls().length).toBe(0);
    expect(billing.tokensUsedMonth).toBe(4200);
  });

  it('free user with month_start = Sept 28 issues the conditional reset on Oct 1', async () => {
    const db = makeFakeDb();
    db._setSelectRows([{ userId: 'u1', planId: 1, monthStart: daysAgo(3), tokensUsedMonth: 4200 }]);

    await new BillingService(db, 'u1').getOrResetUserBilling();

    expect(db._execCalls().length).toBe(1);
    const { sql, params } = renderSql(db._execCalls()[0].raw);
    // Plan-split guard is in the SQL itself (race-safe), with the same
    // boundaries the fast path used.
    expect(sql).toMatch(/plan_id = \$\d+ AND month_start < \$\d+/);
    expect(sql).toMatch(/plan_id <> \$\d+ AND month_start < \$\d+/);
    expect(params).toContainEqual(new Date('2026-10-01T00:00:00Z')); // calendar boundary
    expect(params).toContainEqual(daysAgo(30)); // paid 30-day cutoff
  });

  it('paid user past the 30-day cycle issues the conditional reset', async () => {
    const db = makeFakeDb();
    db._setSelectRows([{ userId: 'u1', planId: 2, monthStart: daysAgo(31), tokensUsedMonth: 90_000 }]);

    await new BillingService(db, 'u1').getOrResetUserBilling();

    expect(db._execCalls().length).toBe(1);
  });
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
        // Stale: previous calendar month → the fast path must NOT skip.
        monthStart: new Date(Date.now() - 40 * DAY),
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
