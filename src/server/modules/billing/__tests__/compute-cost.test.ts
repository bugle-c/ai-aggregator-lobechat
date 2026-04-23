import { describe, expect, it } from 'vitest';

import { computeCostUsdFromRate, type RateView } from '../compute-cost';

const TOKENS_RATE: RateView = {
  modelId: 'claude-opus-4-6',
  provider: 'anthropic',
  pricingUnit: 'tokens',
  inputPer1M: 5,
  outputPer1M: 25,
  perUnit: null,
  markup: 3,
  tierOverride: null,
  isActive: true,
};

const IMAGE_RATE: RateView = {
  modelId: 'dall-e-3',
  provider: 'openai',
  pricingUnit: 'image',
  inputPer1M: null,
  outputPer1M: null,
  perUnit: 0.04,
  markup: 3,
  tierOverride: null,
  isActive: true,
};

const VIDEO_RATE: RateView = {
  modelId: 'sora-2',
  provider: 'openai',
  pricingUnit: 'second',
  inputPer1M: null,
  outputPer1M: null,
  perUnit: 0.05,
  markup: 3,
  tierOverride: null,
  isActive: true,
};

describe('computeCostUsdFromRate — tokens', () => {
  it('multiplies tokens by rate and applies markup', () => {
    // 1M input + 1M output = ($5 + $25) × markup 3 = $90
    const cost = computeCostUsdFromRate(TOKENS_RATE, {
      kind: 'chat',
      tokens: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
    });
    expect(cost).toBeCloseTo(90, 4);
  });

  it('handles cache tokens with correct multipliers', () => {
    // cache_write_5m = 1M × $5 × 1.25 = $6.25
    // After markup 3: $18.75
    const cost = computeCostUsdFromRate(TOKENS_RATE, {
      kind: 'chat',
      tokens: {
        inputTokens: 0,
        outputTokens: 0,
        cacheWrite5mTokens: 1_000_000,
      },
    });
    expect(cost).toBeCloseTo(18.75, 4);
  });
});

describe('computeCostUsdFromRate — image', () => {
  it('multiplies images by per_unit and markup', () => {
    // 5 × $0.04 × 3 = $0.60
    const cost = computeCostUsdFromRate(IMAGE_RATE, { kind: 'image', images: 5 });
    expect(cost).toBeCloseTo(0.6, 4);
  });

  it('defaults to 1 image if not provided', () => {
    const cost = computeCostUsdFromRate(IMAGE_RATE, { kind: 'image', images: undefined });
    expect(cost).toBeCloseTo(0.12, 4); // $0.04 × 3 × 1
  });
});

describe('computeCostUsdFromRate — second (video)', () => {
  it('multiplies seconds by per_unit and markup', () => {
    // 10 sec × $0.05 × 3 = $1.50
    const cost = computeCostUsdFromRate(VIDEO_RATE, { kind: 'video', videoSeconds: 10 });
    expect(cost).toBeCloseTo(1.5, 4);
  });

  it('returns 0 for 0 seconds', () => {
    const cost = computeCostUsdFromRate(VIDEO_RATE, { kind: 'video', videoSeconds: 0 });
    expect(cost).toBe(0);
  });
});

describe('computeCostUsdFromRate — pricing_unit/kind mismatch', () => {
  it('returns 0 for video-kind against tokens-rate (should not happen)', () => {
    const cost = computeCostUsdFromRate(TOKENS_RATE, { kind: 'video', videoSeconds: 10 });
    expect(cost).toBe(0);
  });
});
