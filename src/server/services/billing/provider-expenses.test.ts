import { afterEach, describe, expect, it, vi } from 'vitest';

import { expenseCoverage, fetchWaveSpeedOperations, resolveWaveSpeedCost, type WaveSpeedOperation } from './provider-expenses';

const operation = (uuid: string, billing_type = 'deduct', price = 0.024): WaveSpeedOperation => ({
  uuid, billing_type, price, prediction: { uuid: 'prediction' },
});
afterEach(() => vi.unstubAllGlobals());

describe('verified WaveSpeed expenses', () => {
  it('downgrades ten verified requests when an eleventh unresolved request arrives', () => {
    expect(expenseCoverage(10, 10, 10)).toEqual({ status: 'verified', verifiedRequests: 10, unresolvedRequests: 0 });
    expect(expenseCoverage(11, 10, 10)).toEqual({ status: 'partial', verifiedRequests: 10, unresolvedRequests: 1 });
    expect(expenseCoverage(11, 10, 0)).toEqual({ status: 'partial', verifiedRequests: 10, unresolvedRequests: 1 });
  });
  it('deduplicates exact financial operations without inferring catalog costs', () => {
    const deduct = operation('a');
    expect(resolveWaveSpeedCost('prediction', [deduct, deduct])?.costUsd).toBe(0.024);
    expect(resolveWaveSpeedCost('other', [deduct])).toBeNull();
  });
  it('nets observed positive refunds, preserving verified zero', () => {
    const result = resolveWaveSpeedCost('prediction', [operation('a'), operation('b', 'refund')]);
    expect(result?.costUsd).toBe(0);
    expect(result?.evidence.operations).toHaveLength(2);
  });
  it('does not label reservations, unknown types, unmatched refunds or negative net as actual', () => {
    expect(resolveWaveSpeedCost('prediction', [operation('a', 'reserve')])).toBeNull();
    expect(resolveWaveSpeedCost('prediction', [operation('a', 'refund')])).toBeNull();
    expect(resolveWaveSpeedCost('prediction', [operation('a'), operation('b', 'refund', 1)])).toBeNull();
  });
  it('paginates exact prediction lookup and deduplicates operation UUIDs', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ code: 200, data: { items: [operation('a')], has_more: true } }))
      .mockResolvedValueOnce(Response.json({ code: 200, data: { items: [operation('a'), operation('b', 'refund')], has_more: false } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchWaveSpeedOperations(['prediction'], 'key')).toHaveLength(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ prediction_uuids: ['prediction'], page: 2, page_size: 100 });
  });
  it('propagates API denial and malformed amounts instead of inventing zero', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403 })));
    await expect(fetchWaveSpeedOperations(['prediction'], 'key')).rejects.toThrow('403');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ code: 200, data: { items: [operation('a', 'deduct', -1)], has_more: false } })));
    await expect(fetchWaveSpeedOperations(['prediction'], 'key')).rejects.toThrow('Invalid WaveSpeed operation');
  });
  it.each([
    { ...operation('a'), prediction: { uuid: 123 } },
    { ...operation('a'), order: { uuid: 'order', state: null } },
    { ...operation('a'), uuid: '' },
  ])('rejects malformed nested financial evidence', async (item) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ code: 200, data: { items: [item], has_more: false } })));
    await expect(fetchWaveSpeedOperations(['prediction'], 'key')).rejects.toThrow('Invalid WaveSpeed operation');
  });

  it('leaves pre-settlement deductions pending', () => {
    expect(resolveWaveSpeedCost('prediction', [{ ...operation('a'), order: { uuid: 'order', state: 'pre' } }])).toBeNull();
  });
});
