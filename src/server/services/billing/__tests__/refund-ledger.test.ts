import { beforeEach, describe, expect, it, vi } from 'vitest';

import { creditHolds, refundCreditLots, userBilling } from '@/database/schemas';
import type { LobeChatDatabase, Transaction } from '@/database/type';
import type { UserBillingItem } from '@/database/schemas';

import { BillingService } from '../index';

vi.mock('../plans-source', () => ({ fetchPlanById: vi.fn(async () => ({ tokenLimit: 100, slug: 'free' })), fetchActivePlans: vi.fn() }));

// Scripted transaction seam: records source mutations without pretending to exercise PostgreSQL locks.
function fixture() {
  const billing = { userId: 'u', planId: 1, monthStart: new Date(), tokensUsedMonth: 95, tokenBalance: 0, bonusBalance: 0, bonusBalanceExpiresAt: null };
  const queues: unknown[][] = [];
  const writes: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  interface Chain extends PromiseLike<unknown[]> {
    from: () => Chain; where: () => Chain; orderBy: () => Chain;
    limit: () => Promise<unknown[]>; for: () => Promise<unknown[]>;
  }
  const fake = {
    select: () => {
      const rows = queues.shift() ?? [];
      const chain: Chain = { from: () => chain, where: () => chain, orderBy: () => chain,
        limit: async () => rows, for: async () => rows, then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject) };
      return chain;
    },
    update: (table: unknown) => ({ set: (values: Record<string, unknown>) => ({ where: async () => { writes.push({ table, values }); } }) }),
    insert: (table: unknown) => ({ values: (values: Record<string, unknown>) => {
      writes.push({ table, values });
      return { returning: async () => [{ id: `hold-${writes.length}`, ...values }] };
    } }),
    transaction: async <T>(fn: (client: Transaction) => Promise<T>) => fn(db),
  };
  // The fixture implements only the fluent operations exercised by this service.
  const db = fake as unknown as LobeChatDatabase & Transaction;
  return { billing, queues, writes, db, service: new BillingService(db, 'u') };
}

beforeEach(() => vi.clearAllMocks());

describe('source-aware correction credit ledger', () => {
  it('repeated campaign/usage grants zero without creating another lot', async () => {
    const f = fixture();
    // The scripted billing fixture supplies only fields used by this service.
    vi.spyOn(f.service, 'getOrCreateUserBilling').mockResolvedValue(f.billing as unknown as UserBillingItem);
    f.queues.push([f.billing], [], [{ id: 'paid' }], [{ id: 'usage', creditsCharged: 10,
      providerCostStatus: 'verified', actualProviderCostUsd: '0.01', providerRequestId: 'generation', providerCostSource: 'provider' }], [{ id: 'existing' }]);
    expect(await f.service.grantRefundCorrections({ campaign: 'reviewed', fixCutoff: new Date('2026-10-20'), corrections: [{
      usageId: 'usage', correctedCredits: 4, evidence: { source: 'provider', reference: 'generation', pricing: 'archived-pricing-fx' },
    }] })).toEqual({ granted: 0, lotId: null });
    expect(f.writes).toEqual([]);
  });

  it('ineligible customers cannot receive arbitrary historical grants', async () => {
    const f = fixture();
    // The scripted billing fixture supplies only fields used by this service.
    vi.spyOn(f.service, 'getOrCreateUserBilling').mockResolvedValue(f.billing as unknown as UserBillingItem);
    f.queues.push([f.billing], [], []);
    await expect(f.service.grantRefundCorrections({ campaign: 'reviewed', fixCutoff: new Date('2026-10-20'), corrections: [] })).rejects.toThrow('Not eligible');
    expect(f.writes).toEqual([]);
  });
  it('splits a batch hold into independent per-image sources without restoring any balance', async () => {
    const f = fixture();
    f.queues.push([f.billing], [{ id: 'batch', amount: 9, ordinaryAmount: 4, usagePeriod: f.billing.monthStart,
      refundAllocations: [{ lotId: 'original-expiring', amount: 5 }], releasedAt: null, reason: 'image-gen', createdAt: new Date() }]);
    const children = await f.service.splitCreditHold('batch', [3, 3, 3], f.db);
    expect(children.map((hold) => hold.ordinaryAmount)).toEqual([0, 1, 3]);
    expect(children.map((hold) => hold.refundAllocations)).toEqual([
      [{ lotId: 'original-expiring', amount: 3 }], [{ lotId: 'original-expiring', amount: 2 }], [],
    ]);
    expect(f.writes.some((write) => write.table === userBilling || write.table === refundCreditLots)).toBe(false);
    expect(new Set(children.map((hold) => hold.id)).size).toBe(3);
    expect(children.every((hold) => hold.usagePeriod === f.billing.monthStart)).toBe(true);
  });
  it('spends refund lots in query expiry order before ordinary allowance', async () => {
    const f = fixture();
    f.queues.push([f.billing], [{ id: 'early', remaining: 3 }, { id: 'late', remaining: 5 }]);
    const result = await f.service.spendCredits(10, f.db);
    expect(result).toMatchObject({ committed: 10, ordinaryAmount: 2, refundAllocations: [{ lotId: 'early', amount: 3 }, { lotId: 'late', amount: 5 }] });
    expect(f.writes.filter((w) => w.table === refundCreditLots).map((w) => w.values.remaining)).toEqual([0, 0]);
    expect(f.writes.find((w) => w.table === userBilling)?.values.tokensUsedMonth).toBe(97);
  });

  it('rejects overspending before mutating either source', async () => {
    const f = fixture(); f.queues.push([f.billing], [{ id: 'lot', remaining: 2 }]);
    await expect(f.service.spendCredits(8, f.db)).rejects.toThrow('Insufficient credits');
    expect(f.writes).toEqual([]);
  });

  it('clamps post-completion spending inside the locked transaction', async () => {
    const f = fixture(); f.queues.push([f.billing], [{ id: 'lot', remaining: 2 }]);
    expect(await f.service.spendCredits(20, f.db, { clamp: true })).toMatchObject({ committed: 7, ordinaryAmount: 5 });
  });

  it('persists reservation sources and period for later exact restoration', async () => {
    const f = fixture(); f.queues.push([f.billing], [{ id: 'lot', remaining: 3 }]);
    const hold = await f.service.reserveCredits(7, 'image-gen', undefined, f.db);
    expect(hold).toMatchObject({ amount: 7, ordinaryAmount: 4, usagePeriod: f.billing.monthStart, refundAllocations: [{ lotId: 'lot', amount: 3 }] });
  });

  it('duplicate completion does not restore or charge any source', async () => {
    const f = fixture(); f.queues.push([f.billing], [{ id: 'h', releasedAt: new Date() }]);
    expect(await f.service.settleCreditHold('h', 0, f.db)).toEqual({ settled: false, committed: 0 });
    expect(f.writes).toEqual([]);
  });

  it('old-period failed hold never decrements new-period ordinary usage', async () => {
    const f = fixture(); f.queues.push([f.billing], [{ id: 'h', amount: 10, ordinaryAmount: 6,
      usagePeriod: new Date('2020-01-01'), refundAllocations: [{ lotId: 'expired', amount: 4 }], releasedAt: null }]);
    await f.service.settleCreditHold('h', 0, f.db);
    expect(f.writes.some((w) => w.table === userBilling)).toBe(false);
    expect(f.writes.some((w) => w.table === refundCreditLots)).toBe(true);
    expect(f.writes.find((w) => w.table === creditHolds)?.values.releasedAt).toBeInstanceOf(Date);
  });

  it('invalid or missing evidence cannot initiate arbitrary historical credit grants', async () => {
    const f = fixture();
    await expect(f.service.grantRefundCorrections({ campaign: '', fixCutoff: new Date(), corrections: [] })).rejects.toThrow('Invalid reviewed');
    expect(f.writes).toEqual([]);
  });
});
