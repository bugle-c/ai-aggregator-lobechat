import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '../route';

/**
 * Smoke tests for the sanity-check cron route. We mock the database
 * layer, rates source, and alert dispatcher so the route can run end
 * to end in unit-test isolation. The goal is auth correctness +
 * "happy path returns JSON" — deeper per-check logic is exercised
 * directly elsewhere.
 */

const mocks = vi.hoisted(() => {
  const limitMock = vi.fn();
  const whereMock = vi.fn(() => ({ limit: limitMock }));
  const innerJoinMock = vi.fn(() => ({ where: whereMock }));
  const fromMock = vi.fn(() => ({
    innerJoin: innerJoinMock,
    where: whereMock,
  }));
  const selectMock = vi.fn(() => ({ from: fromMock }));

  return {
    fetchAllRatesMock: vi.fn(),
    fromMock,
    innerJoinMock,
    limitMock,
    selectMock,
    sendAlertMock: vi.fn(),
    whereMock,
  };
});

vi.mock('@/database/server', () => ({
  getServerDB: vi.fn(async () => ({
    select: mocks.selectMock,
  })),
}));

vi.mock('@/server/services/billing/rates-source', () => ({
  fetchAllRates: mocks.fetchAllRatesMock,
}));

vi.mock('@/server/services/alerts', () => ({
  sendAlert: mocks.sendAlertMock,
}));

const {
  fetchAllRatesMock,
  fromMock,
  innerJoinMock,
  limitMock,
  selectMock,
  sendAlertMock,
  whereMock,
} = mocks;

describe('POST /api/cron/billing-sanity-checks', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret';
    fetchAllRatesMock.mockReset();
    sendAlertMock.mockReset();
    selectMock.mockClear();
    fromMock.mockClear();
    innerJoinMock.mockClear();
    whereMock.mockClear();
    limitMock.mockReset();
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it('returns 401 without auth header', async () => {
    const res = await POST(
      new Request('http://localhost/api/cron/billing-sanity-checks', { method: 'POST' }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong bearer token', async () => {
    const res = await POST(
      new Request('http://localhost/api/cron/billing-sanity-checks', {
        headers: { authorization: 'Bearer nope' },
        method: 'POST',
      }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 200 with checks payload when auth is valid and all checks pass', async () => {
    // Drizzle queries used by the route (overshoot select, zero-cost select,
    // count) all funnel through the same selectMock chain. Default each
    // .limit() / .where() final call to an empty result set.
    limitMock.mockResolvedValue([]);
    // Stuck-async-tasks uses .where without .limit and returns count
    // directly: emulate by making whereMock awaitable too.
    whereMock.mockImplementation(() => {
      const chain: any = Promise.resolve([{ stuckCount: 0 }]);
      chain.limit = limitMock;
      return chain;
    });

    fetchAllRatesMock.mockResolvedValue([
      { markup: 3, modelId: 'claude-opus-4-6', provider: 'anthropic' },
    ]);

    const res = await POST(
      new Request('http://localhost/api/cron/billing-sanity-checks', {
        headers: { authorization: 'Bearer test-secret' },
        method: 'POST',
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.checks)).toBe(true);
    expect(typeof body.scannedAt).toBe('string');
    // Each of A/B/C/D should appear in the report.
    const names = body.checks.map((c: { name: string }) => c.name);
    expect(names).toContain('negative-balances');
    expect(names).toContain('markup-sanity');
    expect(names).toContain('reconciliation');
    expect(names).toContain('stuck-async-tasks');
  });

  it('flags markup outliers and dispatches a warning alert', async () => {
    limitMock.mockResolvedValue([]);
    whereMock.mockImplementation(() => {
      const chain: any = Promise.resolve([{ stuckCount: 0 }]);
      chain.limit = limitMock;
      return chain;
    });

    fetchAllRatesMock.mockResolvedValue([
      { markup: 0.5, modelId: 'cheap-model', provider: 'openai' }, // too low
      { markup: 50, modelId: 'expensive-model', provider: 'openai' }, // too high
      { markup: 3, modelId: 'fine-model', provider: 'anthropic' },
    ]);

    const res = await POST(
      new Request('http://localhost/api/cron/billing-sanity-checks', {
        headers: { authorization: 'Bearer test-secret' },
        method: 'POST',
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const markup = body.checks.find((c: { name: string }) => c.name === 'markup-sanity');
    expect(markup.severity).toBe('warning');
    expect(sendAlertMock).toHaveBeenCalled();
    const alertCall = sendAlertMock.mock.calls.find((c) => String(c[0].title).includes('markup'));
    expect(alertCall).toBeDefined();
    expect(alertCall![0].severity).toBe('warning');
  });
});
