import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { classifyModelTierAsync, getModelsByTierAsync, invalidateRatesCache } from '../model-tiers';

const ROWS = [
  {
    model_id: 'claude-opus-4-6',
    provider: 'anthropic',
    pricing_unit: 'tokens',
    input_per_1m: '5',
    output_per_1m: '25',
    per_unit: null,
    markup: '3',
    tier_override: null,
    is_active: true,
  },
  {
    model_id: 'claude-sonnet-4-6',
    provider: 'anthropic',
    pricing_unit: 'tokens',
    input_per_1m: '3',
    output_per_1m: '15',
    per_unit: null,
    markup: '3',
    tier_override: null,
    is_active: true,
  },
  {
    model_id: 'claude-haiku-4-5-20251001',
    provider: 'anthropic',
    pricing_unit: 'tokens',
    input_per_1m: '1',
    output_per_1m: '5',
    per_unit: null,
    markup: '3',
    tier_override: null,
    is_active: true,
  },
  {
    model_id: 'gpt-5-nano',
    provider: 'openai',
    pricing_unit: 'tokens',
    input_per_1m: '0.1',
    output_per_1m: '0.4',
    per_unit: null,
    markup: '3',
    tier_override: null,
    is_active: true,
  },
  {
    model_id: 'dall-e-3',
    provider: 'openai',
    pricing_unit: 'image',
    input_per_1m: null,
    output_per_1m: null,
    per_unit: '0.04',
    markup: '3',
    tier_override: null,
    is_active: true,
  },
  {
    model_id: 'sora-2',
    provider: 'openai',
    pricing_unit: 'second',
    input_per_1m: null,
    output_per_1m: null,
    per_unit: '0.05',
    markup: '3',
    tier_override: null,
    is_active: true,
  },
  {
    model_id: '__default__',
    provider: 'unknown',
    pricing_unit: 'tokens',
    input_per_1m: '5',
    output_per_1m: '25',
    per_unit: null,
    markup: '3',
    tier_override: null,
    is_active: true,
  },
];

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  globalThis.fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ROWS }) as unknown as typeof fetch;
  invalidateRatesCache();
});

afterEach(() => {
  invalidateRatesCache();
});

describe('classifyModelTierAsync — tokens', () => {
  it('opus × markup 3 → premium', async () => {
    // output $25 × markup 3 = $75 → > $45 → premium
    expect(await classifyModelTierAsync('claude-opus-4-6')).toBe('premium');
  });

  it('sonnet × markup 3 → high (at upper bound)', async () => {
    // $15 × 3 = $45 hits the high/premium boundary exactly; using ≤ it falls into high.
    expect(await classifyModelTierAsync('claude-sonnet-4-6')).toBe('high');
  });

  it('haiku × markup 3 → mid', async () => {
    // $5 × 3 = $15 → mid (≤15)
    expect(await classifyModelTierAsync('claude-haiku-4-5-20251001')).toBe('mid');
  });

  it('gpt-5-nano × markup 3 → cheap', async () => {
    // $0.4 × 3 = $1.2 → cheap (≤3)
    expect(await classifyModelTierAsync('gpt-5-nano')).toBe('cheap');
  });
});

describe('classifyModelTierAsync — image', () => {
  it('dall-e-3 × markup 3 = $0.12 → mid', async () => {
    expect(await classifyModelTierAsync('dall-e-3')).toBe('mid');
  });
});

describe('classifyModelTierAsync — second', () => {
  it('sora-2 × markup 3 = $0.15/sec → mid', async () => {
    expect(await classifyModelTierAsync('sora-2')).toBe('mid');
  });
});

describe('classifyModelTierAsync — unknown model', () => {
  it('falls back to __default__ classification (premium)', async () => {
    expect(await classifyModelTierAsync('absolutely-unknown-model')).toBe('premium');
  });
});

describe('classifyModelTierAsync — tier_override', () => {
  it('honours tier_override when set', async () => {
    const withOverride = [{ ...ROWS[0], tier_override: 'cheap' }, ROWS[6]];
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => withOverride,
    }) as unknown as typeof fetch;
    invalidateRatesCache();
    expect(await classifyModelTierAsync('claude-opus-4-6')).toBe('cheap');
  });
});

describe('getModelsByTierAsync', () => {
  it('buckets all rates correctly', async () => {
    const premium = await getModelsByTierAsync('premium');
    expect(premium).toContain('claude-opus-4-6');
    const mid = await getModelsByTierAsync('mid');
    expect(mid).toContain('dall-e-3');
    expect(mid).toContain('sora-2');
  });
});
