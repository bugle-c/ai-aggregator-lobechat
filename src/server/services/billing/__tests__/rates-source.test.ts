import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchAllRates, fetchRate, invalidateRatesCache } from '../rates-source';

const OPUS_ROW = {
  model_id: 'claude-opus-4-6',
  provider: 'anthropic',
  pricing_unit: 'tokens',
  input_per_1m: '5.0000',
  output_per_1m: '25.0000',
  per_unit: null,
  markup: '3.00',
  tier_override: null,
  is_active: true,
};
const DEFAULT_ROW = {
  model_id: '__default__',
  provider: 'unknown',
  pricing_unit: 'tokens',
  input_per_1m: '5.0000',
  output_per_1m: '25.0000',
  per_unit: null,
  markup: '3.00',
  tier_override: null,
  is_active: true,
};

const mockFetch = vi.fn();

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  globalThis.fetch = mockFetch as unknown as typeof fetch;
  invalidateRatesCache();
  mockFetch.mockReset();
});

afterEach(() => {
  invalidateRatesCache();
  vi.useRealTimers();
});

describe('fetchRate', () => {
  it('returns normalised row for a known model', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [OPUS_ROW, DEFAULT_ROW],
    });
    const rate = await fetchRate('claude-opus-4-6');
    expect(rate).toMatchObject({
      modelId: 'claude-opus-4-6',
      pricingUnit: 'tokens',
      inputPer1M: 5,
      outputPer1M: 25,
      markup: 3,
      isActive: true,
    });
  });

  it('falls back to __default__ row for unknown chat models', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [OPUS_ROW, DEFAULT_ROW],
    });
    const rate = await fetchRate('some-unknown-model');
    expect(rate?.modelId).toBe('__default__');
    expect(rate?.pricingUnit).toBe('tokens');
  });

  it('returns undefined when no row and no __default__', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [OPUS_ROW],
    });
    const rate = await fetchRate('some-unknown-model');
    expect(rate).toBeUndefined();
  });
});

describe('fetchRate — stale-on-error', () => {
  it('returns last known value when Supabase fails after TTL expiry', async () => {
    // First: successful load seeds cache
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [OPUS_ROW, DEFAULT_ROW],
    });
    await fetchRate('claude-opus-4-6');

    // Advance time past TTL (60s) so next call triggers a refetch
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61_000);

    // Supabase fails — cache should still be served
    mockFetch.mockRejectedValueOnce(new Error('network down'));

    const rate = await fetchRate('claude-opus-4-6');
    expect(rate?.modelId).toBe('claude-opus-4-6');
  });
});

describe('fetchAllRates', () => {
  it('returns all active rows (server-side filter is_active=eq.true)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [OPUS_ROW, DEFAULT_ROW],
    });
    const rates = await fetchAllRates();
    expect(rates.map((r) => r.modelId).sort()).toEqual(['__default__', 'claude-opus-4-6']);
  });

  it('uses is_active=eq.true server-side filter in the REST URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [OPUS_ROW, DEFAULT_ROW],
    });
    await fetchAllRates();
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('is_active=eq.true');
  });
});
