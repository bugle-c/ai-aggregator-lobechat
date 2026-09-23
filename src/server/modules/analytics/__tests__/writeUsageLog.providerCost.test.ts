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
});
