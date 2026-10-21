import { describe, expect, it } from 'vitest';

import { convertOpenAIResponseUsage, convertOpenAIUsage } from './openai';

describe('actual OpenRouter billing usage', () => {
  it.each([0, 0.0151])('preserves actual cost %s independently of estimates', (cost) => {
    const result = convertOpenAIUsage({
      prompt_tokens: 1000,
      completion_tokens: 200,
      total_tokens: 1200,
      cost,
    } as Parameters<typeof convertOpenAIUsage>[0]);
    expect(result).toMatchObject({ providerCostUsd: cost });
  });

  it('keeps cache reads, writes and ordinary input mutually exclusive', () => {
    const result = convertOpenAIUsage({
      prompt_tokens: 1000,
      completion_tokens: 200,
      total_tokens: 1200,
      prompt_tokens_details: { cached_tokens: 800, cache_write_tokens: 100 },
    } as Parameters<typeof convertOpenAIUsage>[0]);
    expect(result).toMatchObject({
      totalInputTokens: 1000,
      inputCacheMissTokens: 100,
      inputCachedTokens: 800,
      inputWriteCacheTokens: 100,
    });
  });

  it('preserves zero ordinary input for an entirely cached prompt', () => {
    const result = convertOpenAIUsage({
      prompt_tokens: 1000,
      completion_tokens: 20,
      total_tokens: 1020,
      prompt_tokens_details: { cached_tokens: 1000 },
    });
    expect(result.inputCacheMissTokens).toBe(0);
  });

  it('preserves actual cost in Responses usage', () => {
    const result = convertOpenAIResponseUsage({
      input_tokens: 1000,
      input_tokens_details: { cached_tokens: 800 },
      output_tokens: 200,
      output_tokens_details: { reasoning_tokens: 50 },
      total_tokens: 1200,
      cost: 0.0151,
    } as Parameters<typeof convertOpenAIResponseUsage>[0]);
    expect(result).toMatchObject({ providerCostUsd: 0.0151, totalOutputTokens: 200 });
  });
});
