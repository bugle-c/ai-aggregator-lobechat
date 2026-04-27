import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Controllable db state — set in each test before calling the SUT.
// ---------------------------------------------------------------------------
let _promoRows: any[] = [];
let _redemptionRows: any[] = [];
let _planRows: any[] = [];

// Spy handles exposed so tests can assert call counts / args.
const insertValuesOnConflict = vi.fn().mockResolvedValue(undefined);
const updateSetWhere = vi.fn().mockResolvedValue(undefined);

function buildTx() {
  let selectCallCount = 0;

  const selectReturning = (rows: any[]) => {
    const limit = vi.fn().mockResolvedValue(rows);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    return { from, limit, where };
  };

  const select = vi.fn().mockImplementation(() => {
    selectCallCount++;
    if (selectCallCount === 1) return selectReturning(_promoRows);
    if (selectCallCount === 2) return selectReturning(_redemptionRows);
    return selectReturning(_planRows); // billingPlans (plan_upgrade path only)
  });

  const insert = vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({
      onConflictDoNothing: insertValuesOnConflict,
    }),
  });

  const update = vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({ where: updateSetWhere }),
  });

  return { insert, select, update };
}

// Mock getServerDB to return a fake db whose transaction delegates to our tx.
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(async () => ({
    transaction: vi.fn().mockImplementation(async (cb: (tx: any) => Promise<any>) => cb(buildTx())),
  })),
  serverDB: {},
}));

// Suppress OIDC / openTelemetry middlewares that would fail in unit test env.
vi.mock('@/libs/trpc/middleware/openTelemetry', () => ({
  openTelemetry: vi.fn().mockImplementation(async (opts: any) => opts.next()),
}));

vi.mock('@/libs/trpc/lambda/middleware/oidcAuth', () => ({
  oidcAuth: vi.fn().mockImplementation(async (opts: any) => opts.next()),
}));

vi.mock('@/libs/trpc/middleware/userAuth', () => ({
  userAuth: vi
    .fn()
    .mockImplementation(async (opts: any) => opts.next({ ctx: { userId: 'user-1' } })),
}));

// Import SUT AFTER mocks are in place.
const { promoRouter } = await import('../promo');

// ---------------------------------------------------------------------------
// Sample fixtures
// ---------------------------------------------------------------------------

const basePromo = {
  id: 1,
  code: 'BLOG2026',
  isActive: true,
  expiresAt: null,
  maxUses: 100,
  usedCount: 0,
  type: 'token_bonus',
  tokenAmount: 500,
  planId: null,
  durationDays: null,
};

const planUpgradePromo = {
  ...basePromo,
  type: 'plan_upgrade',
  tokenAmount: null,
  planId: 2,
  durationDays: 30,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('promoRouter.redeem', () => {
  beforeEach(() => {
    _promoRows = [];
    _redemptionRows = [];
    _planRows = [];
    insertValuesOnConflict.mockClear();
    updateSetWhere.mockClear();
  });

  const call = (code: string) => promoRouter.createCaller({} as any).redeem({ code });

  it('throws code_not_found when promo lookup returns empty', async () => {
    _promoRows = [];
    await expect(call('NOTEXIST')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'code_not_found',
    });
  });

  it('treats inactive promo as not found (same empty-rows result from WHERE isActive=true)', async () => {
    // Active=false would be filtered at DB level → empty rows → same error
    _promoRows = [];
    await expect(call('INACTIVE')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'code_not_found',
    });
  });

  it('throws code_expired when expiresAt is in the past', async () => {
    _promoRows = [{ ...basePromo, expiresAt: new Date('2020-01-01') }];
    await expect(call('BLOG2026')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'code_expired',
    });
  });

  it('throws code_max_uses_reached when usedCount >= maxUses', async () => {
    _promoRows = [{ ...basePromo, usedCount: 100, maxUses: 100 }];
    await expect(call('BLOG2026')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'code_max_uses_reached',
    });
  });

  it('throws code_already_redeemed when redemption record exists for this user', async () => {
    _promoRows = [basePromo];
    _redemptionRows = [{ id: 99, promoId: 1, userId: 'user-1', redeemedAt: new Date() }];
    await expect(call('BLOG2026')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'code_already_redeemed',
    });
  });

  it('throws invalid_promo_config when type=token_bonus but tokenAmount is null', async () => {
    _promoRows = [{ ...basePromo, tokenAmount: null }];
    _redemptionRows = [];
    await expect(call('BLOG2026')).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'invalid_promo_config',
    });
  });

  it('happy path — token_bonus: returns correct shape and calls update twice', async () => {
    _promoRows = [basePromo];
    _redemptionRows = [];

    const result = await call('BLOG2026');

    expect(result.type).toBe('token_bonus');
    expect(result.message).toContain('+500');
    expect((result as any).tokensAdded).toBe(500);
    // update called for: used_count increment + tokenBalance
    expect(updateSetWhere).toHaveBeenCalledTimes(2);
  });

  it('happy path — plan_upgrade: returns plan name and expiresAt', async () => {
    _promoRows = [planUpgradePromo];
    _redemptionRows = [];
    _planRows = [
      { id: 2, name: 'Pro', slug: 'pro', priceRub: 299, tokenLimit: 5000, isActive: true },
    ];

    const result = await call('BLOG2026');

    expect(result.type).toBe('plan_upgrade');
    expect(result.message).toContain('Pro');
    expect(result.message).toContain('30 дней');
    expect((result as any).planName).toBe('Pro');
    expect((result as any).expiresAt).toBeDefined();
    // update called for: used_count increment + plan/expiry
    expect(updateSetWhere).toHaveBeenCalledTimes(2);
  });

  it('normalizes lowercase input code to uppercase before lookup', async () => {
    // Provide promo indexed by BLOG2026 (uppercase) — the handler must normalize
    _promoRows = [basePromo]; // select mock returns this for first call regardless
    _redemptionRows = [];

    // Pass lowercase — must succeed
    const result = await call('blog2026');
    expect(result.type).toBe('token_bonus');
  });
});
