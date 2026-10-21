import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { USD_TO_RUB } from '@/server/modules/billing/model-rates';
import { invalidateRatesCache } from '@/server/services/billing/rates-source';

import { computeUsageLogRow } from '../writeUsageLog';

const BANANA_ROW = {
  input_per_1m: null,
  is_active: true,
  markup: '3.00',
  markup_override: null,
  model_id: 'google/nano-banana-2/text-to-image',
  output_per_1m: null,
  per_unit: '0.0700',
  pricing_unit: 'image',
  provider: 'wavespeed',
  tier_override: null,
};

const mockFetch = vi.fn();

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  globalThis.fetch = mockFetch as unknown as typeof fetch;
  invalidateRatesCache();
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ json: async () => [BANANA_ROW], ok: true });
});

afterEach(() => invalidateRatesCache());

describe('computeUsageLogRow — provider cost override for media', () => {
  const base = {
    creditsCharged: 126,
    images: 1,
    inputTokens: 0,
    kind: 'image' as const,
    model: 'google/nano-banana-2/text-to-image',
    outputTokens: 0,
    userId: 'u1',
  };

  it('defaults provider cost to the catalog per-unit price (WaveSpeed render)', async () => {
    const row = await computeUsageLogRow({ ...base, provider: 'lobehub' });
    expect(Number(row.providerCostRub)).toBeCloseTo(0.07 * USD_TO_RUB, 4);
    expect(row.provider).toBe('lobehub');
  });

  it('a router-served render logs provider cost 0 but the same charged value', async () => {
    const wavespeed = await computeUsageLogRow({ ...base, provider: 'lobehub' });
    const router = await computeUsageLogRow({
      ...base,
      provider: 'llm-router',
      providerCostUsd: 0,
    });
    expect(Number(router.providerCostRub)).toBe(0);
    expect(router.costUsd).toBe(wavespeed.costUsd); // what the user pays is unchanged
    expect(router.creditsCharged).toBe(126);
    expect(router.provider).toBe('llm-router');
  });
  it('keeps catalog estimates unknown and exact media identity pending', async () => {
    const unknown = await computeUsageLogRow({ ...base, provider: 'wavespeed' });
    expect(unknown.actualProviderCostUsd).toBeNull();
    expect(unknown.providerCostStatus).toBe('unknown');
    const pending = await computeUsageLogRow({ ...base, provider: 'wavespeed', providerRequestId: 'prediction-id' });
    expect(pending.providerCostStatus).toBe('pending');
    expect(pending.providerRequestId).toBe('prediction-id');
    expect(pending.actualProviderCostUsd).toBeNull();
  });

  it('preserves raw precision, explicit zero, and upstream evidence independently of charges', async () => {
    const evidence = { generation: 'exact-id' };
    const row = await computeUsageLogRow({ ...base, provider: 'wavespeed', providerCostUsd: 0.000000012345, providerCostEvidence: evidence });
    expect(Number(row.actualProviderCostUsd)).toBe(0.000000012345);
    expect(row.providerCostStatus).toBe('verified');
    expect(row.providerCostEvidence).toMatchObject(evidence);
    expect(row.providerCostEvidence.historicalPricing).toMatchObject({
      source: 'usage_log_rate_snapshot', markup: 3, exchangeRate: USD_TO_RUB,
      creditValueRub: 0.15, minimumCredits: 1, rounding: 'ceil', captureStage: 'usage_log_write',
    });
    const zero = await computeUsageLogRow({ ...base, provider: 'wavespeed', providerCostUsd: 0 });
    expect(zero.actualProviderCostUsd).toBe('0');
    expect(zero.creditsCharged).toBe(base.creditsCharged);
  });

  it('retains caller request-time pricing rather than overwriting with a later lookup', async () => {
    const historicalPricing = { markup: 2, source: 'request_reservation' };
    const row = await computeUsageLogRow({ ...base, provider: 'wavespeed', providerCostEvidence: { historicalPricing } });
    expect(row.providerCostEvidence.historicalPricing).toEqual(historicalPricing);
  });

  it.each([NaN, Infinity, -1])('rejects invalid actual USD %s', async (providerCostUsd) => {
    await expect(computeUsageLogRow({ ...base, provider: 'wavespeed', providerCostUsd })).rejects.toThrow('finite nonnegative');
  });
});
