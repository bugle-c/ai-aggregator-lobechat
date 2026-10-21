import { describe, expect, it } from 'vitest';

import { normalizeBillingUsage } from '../normalizeUsage';

describe('billing token and actual cost normalization', () => {
  it('charges exclusive canonical categories and includes reasoning output', () => {
    expect(normalizeBillingUsage({ totalInputTokens: 1000, inputCacheMissTokens: 100,
      inputCachedTokens: 800, inputWriteCacheTokens: 100, totalOutputTokens: 200,
      outputTextTokens: 150, outputReasoningTokens: 50, providerCostUsd: 0.0151, cost: 99,
    })).toEqual({ input: 100, output: 200, cacheRead: 800, cacheWrite5m: 100,
      cacheWrite1h: 0, cost: 0.0151 });
  });
  it('does not reinterpret a UI cost estimate as an actual provider expense', () => {
    expect(normalizeBillingUsage({ totalInputTokens: 100, totalOutputTokens: 20, cost: 99 }).cost).toBeUndefined();
  });
  it('does not subtract cache twice from native Anthropic input', () => {
    expect(normalizeBillingUsage({ input_tokens: 100, output_tokens: 20,
      cache_read_input_tokens: 800, cache_creation_input_tokens: 100,
    })).toMatchObject({ input: 100, output: 20, cacheRead: 800, cacheWrite5m: 100 });
  });
  it('subtracts cache categories from raw OpenAI prompt totals', () => {
    expect(normalizeBillingUsage({ prompt_tokens: 1000, completion_tokens: 200,
      prompt_tokens_details: { cached_tokens: 800, cache_write_tokens: 100 }, cost: 0,
    })).toMatchObject({ input: 100, output: 200, cacheRead: 800, cacheWrite5m: 100, cost: 0 });
  });
  it('keeps fully cached canonical input zero', () => {
    expect(normalizeBillingUsage({ totalInputTokens: 1000, inputCacheMissTokens: 0,
      inputCachedTokens: 1000, totalOutputTokens: 20 }).input).toBe(0);
  });
});
