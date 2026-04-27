import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import { expireSubscriptions } from '../expireSubscriptions';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const fetchPlanByIdMock = vi.fn(async (id: number) => ({
    id,
    name: 'Pro',
    slug: 'pro',
    priceRub: 990,
    tokenLimit: 100_000,
    dailyCreditLimit: null,
    isActive: true,
  }));

  const writeSubscriptionEventMock = vi.fn(async () => undefined);

  return { fetchPlanByIdMock, writeSubscriptionEventMock };
});

vi.mock('@/server/services/billing/plans-source', () => ({
  fetchPlanById: mocks.fetchPlanByIdMock,
}));

vi.mock('../writeSubscriptionEvent', () => ({
  writeSubscriptionEvent: mocks.writeSubscriptionEventMock,
}));

// ---------------------------------------------------------------------------
// DB builder factory — creates a fresh mock db with configurable query results
// ---------------------------------------------------------------------------

interface MockDbConfig {
  /** For each expired userId, rows returned from the cancelled-event check query */
  cancelledEventsByUser?: Record<string, any[]>;
  /** Rows returned from the expired-subscriptions query (no limit) */
  expiredSubscriptions?: any[];
  /** Rows returned from db.select().from().where().limit(500) — usage_warning candidates */
  usageWarningCandidates?: any[];
}

function makeMockDb(config: MockDbConfig = {}) {
  const {
    usageWarningCandidates = [],
    expiredSubscriptions = [],
    cancelledEventsByUser = {},
  } = config;

  // Track update calls for assertions
  const updateCalls: Array<{ setArgs: any }> = [];

  // Track select call index so we can route to the right result
  let selectCallIdx = 0;

  // cancelledEvent check counter (one per expired subscription row)
  let cancelledCheckIdx = 0;
  const expiredUserIds = expiredSubscriptions.map((r) => r.userId);

  const db: any = {
    update: vi.fn(() => ({
      set: vi.fn((setArgs: any) => {
        updateCalls.push({ setArgs });
        return { where: vi.fn(async () => undefined) };
      }),
    })),
    select: vi.fn(() => {
      const callIdx = selectCallIdx++;
      // Call 0: usage_warning candidates query → .from().where().limit(500)
      if (callIdx === 0) {
        return {
          from: () => ({
            where: () => ({
              limit: async () => usageWarningCandidates,
            }),
          }),
        };
      }
      // Call 1+: expired subscriptions query → .from().where() (no limit)
      if (callIdx === 1) {
        return {
          from: () => ({
            where: async () => expiredSubscriptions,
          }),
        };
      }
      // Call 2+: per-user cancelled event check → .from().where().limit(1)
      const userId = expiredUserIds[cancelledCheckIdx++];
      const rows = userId ? (cancelledEventsByUser[userId] ?? []) : [];
      return {
        from: () => ({
          where: () => ({
            limit: async () => rows,
          }),
        }),
      };
    }),
    // Expose updateCalls for assertions
    _updateCalls: updateCalls,
  };

  return db;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('expireSubscriptions', () => {
  beforeEach(() => {
    mocks.fetchPlanByIdMock.mockResolvedValue({
      id: 2,
      name: 'Pro',
      slug: 'pro',
      priceRub: 990,
      tokenLimit: 100_000,
      dailyCreditLimit: null,
      isActive: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // flagExpiringSubscriptions — bulk UPDATE subscription_expiring
  // =========================================================================

  it('issues bulk UPDATE with subscription_expiring flag', async () => {
    const db = makeMockDb();
    await expireSubscriptions(db);

    // First update call is the bulk expiry-warning UPDATE
    expect(db._updateCalls.length).toBeGreaterThanOrEqual(1);
    const firstUpdate = db._updateCalls[0];
    expect(firstUpdate.setArgs.botNotifyPending).toBe(true);
    expect(firstUpdate.setArgs.botNotifyType).toBe('subscription_expiring');
    expect(firstUpdate.setArgs.expiryWarningSentAt).toBeInstanceOf(Date);
  });

  // =========================================================================
  // flagUsageWarnings — per-row UPDATE when ≥80% used
  // =========================================================================

  it('flags usage_warning for user at ≥80% monthly usage', async () => {
    const db = makeMockDb({
      usageWarningCandidates: [
        { userId: 'user-heavy', tokensUsedMonth: 85_000, tokenBalance: 0, planId: 2 },
      ],
    });
    await expireSubscriptions(db);

    const usageWarningUpdate = db._updateCalls.find(
      (c: any) => c.setArgs.botNotifyType === 'usage_warning',
    );
    expect(usageWarningUpdate).toBeDefined();
    expect(usageWarningUpdate.setArgs.botNotifyPending).toBe(true);
    expect(usageWarningUpdate.setArgs.upgradeHintSentAt).toBeInstanceOf(Date);
  });

  it('does NOT flag usage_warning for user below 80% monthly usage', async () => {
    const db = makeMockDb({
      usageWarningCandidates: [
        { userId: 'user-light', tokensUsedMonth: 50_000, tokenBalance: 0, planId: 2 },
      ],
    });
    await expireSubscriptions(db);

    const usageWarningUpdate = db._updateCalls.find(
      (c: any) => c.setArgs.botNotifyType === 'usage_warning',
    );
    expect(usageWarningUpdate).toBeUndefined();
  });

  it('counts tokenBalance towards total available when checking 80% threshold', async () => {
    // tokenLimit=100_000, tokenBalance=50_000 → total=150_000
    // tokensUsedMonth=100_000 → 66.7% — should NOT trigger
    const db = makeMockDb({
      usageWarningCandidates: [
        { userId: 'user-bonus', tokensUsedMonth: 100_000, tokenBalance: 50_000, planId: 2 },
      ],
    });
    await expireSubscriptions(db);

    const usageWarningUpdate = db._updateCalls.find(
      (c: any) => c.setArgs.botNotifyType === 'usage_warning',
    );
    expect(usageWarningUpdate).toBeUndefined();
  });

  // =========================================================================
  // Expiration handling (existing logic)
  // =========================================================================

  it('returns 0 when no subscriptions have expired', async () => {
    const db = makeMockDb({ expiredSubscriptions: [] });
    const written = await expireSubscriptions(db);
    expect(written).toBe(0);
    expect(mocks.writeSubscriptionEventMock).not.toHaveBeenCalled();
  });

  it('writes a cancelled event for expired subscription not yet logged', async () => {
    const db = makeMockDb({
      expiredSubscriptions: [
        { userId: 'user-exp', planId: 2, expiresAt: new Date('2026-01-01T00:00:00Z') },
      ],
      cancelledEventsByUser: { 'user-exp': [] }, // no existing cancelled event
    });

    const written = await expireSubscriptions(db);
    expect(written).toBe(1);
    expect(mocks.writeSubscriptionEventMock).toHaveBeenCalledTimes(1);
    const eventArgs = mocks.writeSubscriptionEventMock.mock.calls[0][1];
    expect(eventArgs.userId).toBe('user-exp');
    expect(eventArgs.toPlanId).toBe(1); // downgraded to Free
    expect(eventArgs.fromPlanPrice).toBe(990);
  });

  it('skips user whose cancelled event was already written after expiry', async () => {
    const db = makeMockDb({
      expiredSubscriptions: [
        { userId: 'user-already', planId: 2, expiresAt: new Date('2026-01-01T00:00:00Z') },
      ],
      cancelledEventsByUser: {
        'user-already': [{ id: 'event-already-written' }],
      },
    });

    const written = await expireSubscriptions(db);
    expect(written).toBe(0);
    expect(mocks.writeSubscriptionEventMock).not.toHaveBeenCalled();
  });

  it('processes multiple expired subscriptions independently', async () => {
    const db = makeMockDb({
      expiredSubscriptions: [
        { userId: 'user-a', planId: 2, expiresAt: new Date('2026-01-01') },
        { userId: 'user-b', planId: 2, expiresAt: new Date('2026-02-01') },
      ],
      cancelledEventsByUser: {
        'user-a': [], // write event
        'user-b': [{ id: 'existing' }], // skip
      },
    });

    const written = await expireSubscriptions(db);
    expect(written).toBe(1);
    expect(mocks.writeSubscriptionEventMock).toHaveBeenCalledTimes(1);
    expect(mocks.writeSubscriptionEventMock.mock.calls[0][1].userId).toBe('user-a');
  });
});
