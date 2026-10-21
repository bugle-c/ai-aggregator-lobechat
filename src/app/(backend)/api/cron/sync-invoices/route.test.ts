import { afterEach, describe, expect, it, vi } from 'vitest';

const reconcile = vi.hoisted(() => vi.fn());
vi.mock('@/database/server', () => ({ getServerDB: vi.fn().mockResolvedValue({}) }));
vi.mock('@/server/services/billing/provider-expenses', () => ({ reconcileWaveSpeedExpenses: reconcile }));
import { POST } from './route';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe('independent provider invoice sync', () => {
  it('rejects unauthorized invocation', async () => {
    vi.stubEnv('CRON_SECRET', 'secret');
    expect((await POST(new Request('https://example.test'))).status).toBe(401);
    expect(reconcile).not.toHaveBeenCalled();
  });
  it('never substitutes local sums or archived invoice writes for unavailable upstream evidence', async () => {
    vi.stubEnv('CRON_SECRET', 'secret');
    vi.stubEnv('WAVESPEED_API_KEY', 'key');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    reconcile.mockResolvedValue({ requests: 1, reconciled: 1, daily: [{ actualUsd: '0.024', status: 'partial', verifiedRequests: 1, unresolvedRequests: 2 }] });
    const body = await (await POST(new Request('https://example.test', { headers: { authorization: 'Bearer secret' } }))).json();
    expect(body.results).toContainEqual(expect.objectContaining({ provider: 'openrouter', ok: false, status: 'access_required' }));
    expect(body.invoiceStatus).toBe('unresolved');
    expect(body.results[0]).toMatchObject({ invoiceStatus: 'verified_scoped_actuals', daily: [{ actualUsd: '0.024', status: 'partial' }] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('reports billing API failure rather than importing zero', async () => {
    vi.stubEnv('CRON_SECRET', 'secret');
    vi.stubEnv('WAVESPEED_API_KEY', 'key');
    reconcile.mockRejectedValue(new Error('WaveSpeed billings HTTP 403'));
    const body = await (await POST(new Request('https://example.test', { headers: { authorization: 'Bearer secret' } }))).json();
    expect(body.results[0]).toEqual({ provider: 'wavespeed', ok: false, reason: 'WaveSpeed billings HTTP 403' });
    expect(body.results[0]).not.toHaveProperty('amountUsd');
  });
});
