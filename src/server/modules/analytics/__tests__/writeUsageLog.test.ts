import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { USD_TO_RUB } from '@/server/modules/billing/model-rates';
import { invalidateRatesCache } from '@/server/services/billing/rates-source';

import { computeUsageLogRow } from '../writeUsageLog';

const SONNET_ROW = {
  model_id: 'claude-sonnet-4-6',
  provider: 'anthropic',
  pricing_unit: 'tokens',
  input_per_1m: '3.0000',
  output_per_1m: '15.0000',
  per_unit: null,
  markup: '1.00',
  tier_override: null,
  is_active: true,
};
const NANO_ROW = {
  model_id: 'gpt-5-nano',
  provider: 'openai',
  pricing_unit: 'tokens',
  input_per_1m: '0.1000',
  output_per_1m: '0.4000',
  per_unit: null,
  markup: '1.00',
  tier_override: null,
  is_active: true,
};
const DEFAULT_ROW = {
  model_id: '__default__',
  provider: 'unknown',
  pricing_unit: 'tokens',
  input_per_1m: '3.0000',
  output_per_1m: '15.0000',
  per_unit: null,
  markup: '1.00',
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
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => [SONNET_ROW, NANO_ROW, DEFAULT_ROW],
  });
});

afterEach(() => {
  invalidateRatesCache();
});

describe('computeUsageLogRow', () => {
  it('calculates snapshot costs from model rate', async () => {
    const row = await computeUsageLogRow({
      userId: 'user_abc',
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      creditsCharged: 42,
      kind: 'chat',
    });

    // claude-sonnet-4-6: input 3.0 / output 15.0 per 1M, markup 1.0
    // costUsd = 1.0 * 3 + 0.1 * 15 = 4.5
    expect(Number(row.costUsd)).toBeCloseTo(4.5, 6);
    expect(Number(row.costRub)).toBeCloseTo(4.5 * USD_TO_RUB, 4);
    expect(Number(row.exchangeRate)).toBe(USD_TO_RUB);
    expect(row.userId).toBe('user_abc');
    expect(row.kind).toBe('chat');
  });

  it('falls back to __default__ row for unknown models', async () => {
    const row = await computeUsageLogRow({
      userId: 'user_x',
      model: 'unknown-model-2099',
      provider: 'who',
      inputTokens: 1_000_000,
      outputTokens: 0,
      creditsCharged: 1,
      kind: 'chat',
    });
    // __default__ row: 3 / 15, markup 1.0 → 1M input → $3
    expect(Number(row.costUsd)).toBeCloseTo(3, 6);
  });

  it('zero tokens produces zero cost', async () => {
    const row = await computeUsageLogRow({
      userId: 'u',
      model: 'gpt-5-nano',
      provider: 'openai',
      inputTokens: 0,
      outputTokens: 0,
      creditsCharged: 1,
      kind: 'chat',
    });
    expect(Number(row.costUsd)).toBe(0);
    expect(Number(row.costRub)).toBe(0);
  });
});
