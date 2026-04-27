import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '../route';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before any imports that use them
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  // Two separate limit mocks — one for each query chain:
  //   1. payments path: select().from().innerJoin().where().limit()
  //   2. user_billing path: select().from().where().limit()   (no innerJoin)

  const paymentsLimitMock = vi.fn(async () => [] as any[]);
  const userBillingLimitMock = vi.fn(async () => [] as any[]);

  // payments chain: .from → .innerJoin → .where → .limit
  const paymentsWhereMock = vi.fn(() => ({ limit: paymentsLimitMock }));
  const innerJoinMock = vi.fn(() => ({ where: paymentsWhereMock }));
  const paymentsFromMock = vi.fn(() => ({ innerJoin: innerJoinMock }));

  // user_billing chain: .from → .where → .limit (no innerJoin)
  const userBillingWhereMock = vi.fn(() => ({ limit: userBillingLimitMock }));
  const userBillingFromMock = vi.fn(() => ({ where: userBillingWhereMock }));

  // selectMock returns the appropriate chain based on call order:
  // 1st call → payments chain, 2nd call → user_billing chain
  let selectCallCount = 0;
  const selectMock = vi.fn(() => {
    selectCallCount++;
    if (selectCallCount === 1) {
      return { from: paymentsFromMock };
    }
    return { from: userBillingFromMock };
  });

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
    innerJoinMock,
    paymentsFromMock,
    paymentsLimitMock,
    paymentsWhereMock,
    userBillingFromMock,
    userBillingLimitMock,
    userBillingWhereMock,
    selectMock,
    updateMock,
    updateSetMock,
    updateWhereMock,
    fetchPlanByIdMock,
    globalFetchMock,
    // Expose call-count reset so tests can reset it between runs
    _resetSelectCount: () => {
      selectCallCount = 0;
    },
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

function makeAuthRequest() {
  return makeRequest({ authHeader: 'Bearer test-secret' });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/cron/notify-bot-pending', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret';
    process.env.BOT_NOTIFY_SECRET = 'bot-secret';

    // Default: no pending items in either table
    mocks.paymentsLimitMock.mockResolvedValue([]);
    mocks.userBillingLimitMock.mockResolvedValue([]);
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
    // Reset select call counter so chain routing works correctly
    mocks._resetSelectCount();
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.BOT_NOTIFY_SECRET;
    vi.clearAllMocks();
    mocks._resetSelectCount();
  });

  // =========================================================================
  // Auth
  // =========================================================================

  it('returns 401 without authorization header', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong bearer token', async () => {
    const res = await GET(makeRequest({ authHeader: 'Bearer wrong-token' }));
    expect(res.status).toBe(401);
  });

  // =========================================================================
  // Empty queues
  // =========================================================================

  it('returns 200 with 0 processed when both pending lists are empty', async () => {
    const res = await GET(makeAuthRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed).toBe(0);
    expect(body.errors).toBe(0);
    expect(mocks.globalFetchMock).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Payments path (existing subscription_active)
  // =========================================================================

  it('processes one payment and marks notified when bot returns 200', async () => {
    mocks.paymentsLimitMock.mockResolvedValue([
      { paymentId: 'pay-uuid-1', planId: 1, tgBotChatId: 12345678 },
    ]);

    mocks.globalFetchMock.mockResolvedValue({ ok: true, status: 200 });

    const res = await GET(makeAuthRequest());
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
    const setArgs = mocks.updateSetMock.mock.calls[0][0];
    expect(setArgs.botNotifyPending).toBe(false);
    expect(setArgs.botNotifiedAt).toBeInstanceOf(Date);
  });

  it('marks notified when bot returns 410 (user blocked — not a retry case)', async () => {
    mocks.paymentsLimitMock.mockResolvedValue([
      { paymentId: 'pay-uuid-2', planId: 1, tgBotChatId: 99999 },
    ]);

    mocks.globalFetchMock.mockResolvedValue({ ok: false, status: 410 });

    const res = await GET(makeAuthRequest());
    const body = await res.json();
    expect(body.processed).toBe(1);
    expect(body.errors).toBe(0);

    // DB flag must be cleared
    expect(mocks.updateMock).toHaveBeenCalledTimes(1);
    const setArgs = mocks.updateSetMock.mock.calls[0][0];
    expect(setArgs.botNotifyPending).toBe(false);
  });

  it('leaves payment pending when bot returns 502', async () => {
    mocks.paymentsLimitMock.mockResolvedValue([
      { paymentId: 'pay-uuid-3', planId: 1, tgBotChatId: 77777 },
    ]);

    mocks.globalFetchMock.mockResolvedValue({ ok: false, status: 502 });

    const res = await GET(makeAuthRequest());
    const body = await res.json();
    expect(body.processed).toBe(0);
    expect(body.errors).toBe(1);

    // DB update must NOT have been called
    expect(mocks.updateMock).not.toHaveBeenCalled();
  });

  it('continues loop when first notification fails — second item still processed', async () => {
    mocks.paymentsLimitMock.mockResolvedValue([
      { paymentId: 'pay-fail', planId: 1, tgBotChatId: 11111 },
      { paymentId: 'pay-ok', planId: 1, tgBotChatId: 22222 },
    ]);

    // First call throws (network error), second returns 200
    mocks.globalFetchMock
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const res = await GET(makeAuthRequest());
    const body = await res.json();

    expect(body.processed).toBe(1);
    expect(body.errors).toBe(1);

    // Only the second payment should have been marked notified
    expect(mocks.updateMock).toHaveBeenCalledTimes(1);
    expect(mocks.updateSetMock).toHaveBeenCalledTimes(1);
  });

  // =========================================================================
  // user_billing path — subscription_expiring
  // =========================================================================

  it('delivers subscription_expiring notification from user_billing', async () => {
    const expiresAt = new Date('2026-05-10T12:00:00Z');
    mocks.userBillingLimitMock.mockResolvedValue([
      {
        userId: 'user-1',
        notifyType: 'subscription_expiring',
        tgBotChatId: 55555,
        planId: 2,
        subscriptionExpiresAt: expiresAt,
        tokenBalance: 0,
        tokensUsedMonth: 500,
        monthStart: new Date('2026-04-01T00:00:00Z'),
      },
    ]);

    mocks.globalFetchMock.mockResolvedValue({ ok: true, status: 200 });

    const res = await GET(makeAuthRequest());
    const body = await res.json();
    expect(body.processed).toBe(1);
    expect(body.errors).toBe(0);

    const [url, init] = mocks.globalFetchMock.mock.calls[0];
    expect(url).toMatch(/\/internal\/notify$/);
    const reqBody = JSON.parse(init.body);
    expect(reqBody.tgUserId).toBe(55555);
    expect(reqBody.type).toBe('subscription_expiring');
    expect(reqBody.payload.planName).toBe('Pro');
    expect(reqBody.payload.expiresAt).toBe(expiresAt.toISOString());

    // user_billing flag should be cleared
    expect(mocks.updateMock).toHaveBeenCalledTimes(1);
    const setArgs = mocks.updateSetMock.mock.calls[0][0];
    expect(setArgs.botNotifyPending).toBe(false);
    expect(setArgs.botNotifyType).toBeNull();
  });

  it('delivers zero_credits notification — payload contains daysToReset', async () => {
    // monthStart = 25 days ago → reset in ~5 days
    const monthStart = new Date(Date.now() - 25 * 86_400_000);
    mocks.userBillingLimitMock.mockResolvedValue([
      {
        userId: 'user-2',
        notifyType: 'zero_credits',
        tgBotChatId: 66666,
        planId: 1,
        subscriptionExpiresAt: null,
        tokenBalance: 0,
        tokensUsedMonth: 50_000,
        monthStart,
      },
    ]);

    mocks.globalFetchMock.mockResolvedValue({ ok: true, status: 200 });

    const res = await GET(makeAuthRequest());
    const body = await res.json();
    expect(body.processed).toBe(1);
    expect(body.errors).toBe(0);

    const [, init] = mocks.globalFetchMock.mock.calls[0];
    const reqBody = JSON.parse(init.body);
    expect(reqBody.type).toBe('zero_credits');
    // reset = monthStart + 30 days; ~5 days left → daysToReset should be 5
    expect(typeof reqBody.payload.daysToReset).toBe('number');
    expect(reqBody.payload.daysToReset).toBeGreaterThanOrEqual(4);
    expect(reqBody.payload.daysToReset).toBeLessThanOrEqual(6);
  });

  it('delivers usage_warning notification — payload contains planName and daysLeft', async () => {
    const expiresAt = new Date(Date.now() + 2 * 86_400_000); // 2 days from now
    mocks.userBillingLimitMock.mockResolvedValue([
      {
        userId: 'user-3',
        notifyType: 'usage_warning',
        tgBotChatId: 77777,
        planId: 2,
        subscriptionExpiresAt: expiresAt,
        tokenBalance: 0,
        tokensUsedMonth: 85_000,
        monthStart: new Date('2026-04-01T00:00:00Z'),
      },
    ]);

    mocks.globalFetchMock.mockResolvedValue({ ok: true, status: 200 });

    const res = await GET(makeAuthRequest());
    const body = await res.json();
    expect(body.processed).toBe(1);
    expect(body.errors).toBe(0);

    const [, init] = mocks.globalFetchMock.mock.calls[0];
    const reqBody = JSON.parse(init.body);
    expect(reqBody.type).toBe('usage_warning');
    expect(reqBody.payload.planName).toBe('Pro');
    expect(reqBody.payload.daysLeft).toBe(2);
  });

  it('clears flag without calling bot when notifyType is unknown', async () => {
    mocks.userBillingLimitMock.mockResolvedValue([
      {
        userId: 'user-unknown',
        notifyType: 'some_future_type',
        tgBotChatId: 88888,
        planId: 1,
        subscriptionExpiresAt: null,
        tokenBalance: 0,
        tokensUsedMonth: 0,
        monthStart: new Date(),
      },
    ]);

    const res = await GET(makeAuthRequest());
    const body = await res.json();
    // Unknown type: skipped (continue), so processed=0 errors=0
    expect(body.processed).toBe(0);
    expect(body.errors).toBe(0);

    // Bot should NOT be called
    expect(mocks.globalFetchMock).not.toHaveBeenCalled();

    // DB flag should be cleared
    expect(mocks.updateMock).toHaveBeenCalledTimes(1);
    const setArgs = mocks.updateSetMock.mock.calls[0][0];
    expect(setArgs.botNotifyPending).toBe(false);
    expect(setArgs.botNotifyType).toBeNull();
  });

  it('leaves user_billing pending when bot returns 5xx for subscription_expiring', async () => {
    mocks.userBillingLimitMock.mockResolvedValue([
      {
        userId: 'user-4',
        notifyType: 'subscription_expiring',
        tgBotChatId: 44444,
        planId: 1,
        subscriptionExpiresAt: new Date('2026-04-29T00:00:00Z'),
        tokenBalance: 0,
        tokensUsedMonth: 0,
        monthStart: new Date(),
      },
    ]);

    mocks.globalFetchMock.mockResolvedValue({ ok: false, status: 503 });

    const res = await GET(makeAuthRequest());
    const body = await res.json();
    expect(body.processed).toBe(0);
    expect(body.errors).toBe(1);
    // DB update must NOT be called
    expect(mocks.updateMock).not.toHaveBeenCalled();
  });

  it('marks user_billing notified when bot returns 410 (blocked)', async () => {
    mocks.userBillingLimitMock.mockResolvedValue([
      {
        userId: 'user-5',
        notifyType: 'zero_credits',
        tgBotChatId: 33333,
        planId: 1,
        subscriptionExpiresAt: null,
        tokenBalance: 0,
        tokensUsedMonth: 50_000,
        monthStart: new Date(),
      },
    ]);

    mocks.globalFetchMock.mockResolvedValue({ ok: false, status: 410 });

    const res = await GET(makeAuthRequest());
    const body = await res.json();
    expect(body.processed).toBe(1); // 410 = treated as success
    expect(body.errors).toBe(0);

    expect(mocks.updateMock).toHaveBeenCalledTimes(1);
    const setArgs = mocks.updateSetMock.mock.calls[0][0];
    expect(setArgs.botNotifyPending).toBe(false);
  });
});
