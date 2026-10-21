import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const { settle, transaction } = vi.hoisted(() => ({ settle: vi.fn(), transaction: vi.fn() }));
const tx = {};
vi.mock('@/database/server', () => ({ getServerDB: async () => ({
  select: () => ({ from: () => ({ where: async () => [{ id: 'hold', userId: 'user', amount: 50, createdAt: new Date(0) }] }) }),
  transaction,
}) }));
vi.mock('@/server/services/billing', () => ({ BillingService: vi.fn().mockImplementation(() => ({ settleCreditHold: settle })) }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CRON_SECRET', 'test-secret');
  transaction.mockImplementation(async (fn: (value: object) => Promise<unknown>) => fn(tx));
  settle.mockResolvedValue({ settled: true, committed: 0 });
});
afterEach(() => vi.unstubAllEnvs());
describe('stale hold source-aware cleanup', () => {
  it('settles zero through the original funding allocations', async () => {
    const response = await POST(new Request('http://localhost', { headers: { authorization: 'Bearer test-secret' } }));
    expect(settle).toHaveBeenCalledWith('hold', 0, tx);
    expect(await response.json()).toMatchObject({ results: [{ outcome: 'released' }] });
  });
  it('reports a concurrent completion without refunding twice', async () => {
    settle.mockResolvedValue({ settled: false, committed: 0 });
    const response = await POST(new Request('http://localhost', { headers: { authorization: 'Bearer test-secret' } }));
    expect(await response.json()).toMatchObject({ results: [{ outcome: 'already-settled' }] });
  });
  it('rejects unauthorized cleanup', async () => {
    expect((await POST(new Request('http://localhost'))).status).toBe(401);
    expect(settle).not.toHaveBeenCalled();
  });
});
