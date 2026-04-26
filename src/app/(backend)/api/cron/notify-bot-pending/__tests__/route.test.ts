import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '../route';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before any imports that use them
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  // Drizzle query builder mock — supports the following chain:
  //   db.select({...}).from(t).innerJoin(t2, cond).where(cond).limit(n)
  // and:
  //   db.update(t).set({...}).where(cond)

  const limitMock = vi.fn(async () => [] as any[]);

  const whereMockInner = vi.fn(() => ({ limit: limitMock }));
  const innerJoinMock = vi.fn(() => ({ where: whereMockInner }));
  const fromMock = vi.fn(() => ({ innerJoin: innerJoinMock }));
  const selectMock = vi.fn(() => ({ from: fromMock }));

  // update chain: db.update(t).set({...}).where(cond)
  const updateWhereMock = vi.fn(async () => undefined);
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));

  const fetchPlanByIdMock = vi.fn(async (id: number) => ({
    id,
    name: 'Pro',
    slug: 'pro',
    priceRub: 990,
    tokenLimit: 100_000,
    dailyCreditLimit: null,
    isActive: true,
  }));

  const globalFetchMock = vi.fn();

  return {
    fromMock,
    innerJoinMock,
    limitMock,
    selectMock,
    updateMock,
    updateSetMock,
    updateWhereMock,
    whereMockInner,
    fetchPlanByIdMock,
    globalFetchMock,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/database/server', () => ({
  getServerDB: vi.fn(async () => ({
    select: mocks.selectMock,
    update: mocks.updateMock,
  })),
}));

vi.mock('@/server/services/billing/plans-source', () => ({
  fetchPlanById: mocks.fetchPlanByIdMock,
}));

// Patch global fetch used by the route
vi.stubGlobal('fetch', mocks.globalFetchMock);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(opts: { authHeader?: string } = {}) {
  return new Request('http://localhost/api/cron/notify-bot-pending', {
    headers: opts.authHeader ? { authorization: opts.authHeader } : {},
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/cron/notify-bot-pending', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret';
    process.env.BOT_NOTIFY_SECRET = 'bot-secret';

    // Default: no pending payments
    mocks.limitMock.mockResolvedValue([]);
    mocks.updateWhereMock.mockResolvedValue(undefined);
    mocks.fetchPlanByIdMock.mockResolvedValue({
      id: 1,
      name: 'Pro',
      slug: 'pro',
      priceRub: 990,
      tokenLimit: 100_000,
      dailyCreditLimit: null,
      isActive: true,
    });
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.BOT_NOTIFY_SECRET;
    vi.clearAllMocks();
  });

  it('returns 401 without authorization header', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong bearer token', async () => {
    const res = await GET(makeRequest({ authHeader: 'Bearer wrong-token' }));
    expect(res.status).toBe(401);
  });

  it('returns 200 with 0 processed when pending list is empty', async () => {
    mocks.limitMock.mockResolvedValue([]);

    const res = await GET(makeRequest({ authHeader: 'Bearer test-secret' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed).toBe(0);
    expect(body.errors).toBe(0);

    // fetch should not have been called to the bot
    expect(mocks.globalFetchMock).not.toHaveBeenCalled();
  });

  it('processes one payment and marks notified when bot returns 200', async () => {
    mocks.limitMock.mockResolvedValue([
      { paymentId: 'pay-uuid-1', planId: 1, tgBotChatId: 12345678 },
    ]);

    mocks.globalFetchMock.mockResolvedValue({ ok: true, status: 200 });

    const res = await GET(makeRequest({ authHeader: 'Bearer test-secret' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed).toBe(1);
    expect(body.errors).toBe(0);

    // Bot was called with correct payload
    expect(mocks.globalFetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = mocks.globalFetchMock.mock.calls[0];
    expect(url).toMatch(/\/internal\/notify$/);
    const reqBody = JSON.parse(init.body);
    expect(reqBody.tgUserId).toBe(12345678);
    expect(reqBody.type).toBe('subscription_active');
    expect(reqBody.payload.planName).toBe('Pro');
    expect(reqBody.payload.creditsAdded).toBe(100_000);
    expect(typeof reqBody.payload.expiresAt).toBe('string');

    // DB was updated to clear the flag
    expect(mocks.updateMock).toHaveBeenCalledTimes(1);
    expect(mocks.updateSetMock).toHaveBeenCalledTimes(1);
    const setArgs = mocks.updateSetMock.mock.calls[0][0];
    expect(setArgs.botNotifyPending).toBe(false);
    expect(setArgs.botNotifiedAt).toBeInstanceOf(Date);
  });

  it('marks notified when bot returns 410 (user blocked — not a retry case)', async () => {
    mocks.limitMock.mockResolvedValue([{ paymentId: 'pay-uuid-2', planId: 1, tgBotChatId: 99999 }]);

    mocks.globalFetchMock.mockResolvedValue({ ok: false, status: 410 });

    const res = await GET(makeRequest({ authHeader: 'Bearer test-secret' }));
    const body = await res.json();
    expect(body.processed).toBe(1);
    expect(body.errors).toBe(0);

    // DB flag must be cleared
    expect(mocks.updateMock).toHaveBeenCalledTimes(1);
    const setArgs = mocks.updateSetMock.mock.calls[0][0];
    expect(setArgs.botNotifyPending).toBe(false);
  });

  it('leaves payment pending when bot returns 502', async () => {
    mocks.limitMock.mockResolvedValue([{ paymentId: 'pay-uuid-3', planId: 1, tgBotChatId: 77777 }]);

    mocks.globalFetchMock.mockResolvedValue({ ok: false, status: 502 });

    const res = await GET(makeRequest({ authHeader: 'Bearer test-secret' }));
    const body = await res.json();
    expect(body.processed).toBe(0);
    expect(body.errors).toBe(1);

    // DB update must NOT have been called
    expect(mocks.updateMock).not.toHaveBeenCalled();
  });

  it('continues loop when first notification fails — second item still processed', async () => {
    mocks.limitMock.mockResolvedValue([
      { paymentId: 'pay-fail', planId: 1, tgBotChatId: 11111 },
      { paymentId: 'pay-ok', planId: 1, tgBotChatId: 22222 },
    ]);

    // First call throws (network error), second returns 200
    mocks.globalFetchMock
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const res = await GET(makeRequest({ authHeader: 'Bearer test-secret' }));
    const body = await res.json();

    expect(body.processed).toBe(1);
    expect(body.errors).toBe(1);

    // Only the second payment should have been marked notified
    expect(mocks.updateMock).toHaveBeenCalledTimes(1);
    expect(mocks.updateSetMock).toHaveBeenCalledTimes(1);
  });
});
