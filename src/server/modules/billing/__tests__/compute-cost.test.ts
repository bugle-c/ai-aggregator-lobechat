import { describe, expect, it } from 'vitest';

import {
  computeBaseCostUsdFromRate,
  computeCostUsdFromRate,
  getTierMultiplierForRate,
  type RateView,
} from '../compute-cost';

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
  it('multiplies tokens by rate and applies tier multiplier', () => {
    // 1M input + 1M output = ($5 + $25) × premium multiplier 2.5 = $75
    const cost = computeCostUsdFromRate(TOKENS_RATE, {
      kind: 'chat',
      tokens: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
    });
    expect(cost).toBeCloseTo(75, 4);
  });

  it('handles cache tokens with correct multipliers', () => {
    // cache_write_5m = 1M × $5 × 1.25 = $6.25
    // After premium multiplier 2.5: $15.625
    const cost = computeCostUsdFromRate(TOKENS_RATE, {
      kind: 'chat',
      tokens: {
        inputTokens: 0,
        outputTokens: 0,
        cacheWrite5mTokens: 1_000_000,
      },
    });
    expect(cost).toBeCloseTo(15.625, 4);
  });
});

describe('tier-based billing multipliers', () => {
  it('uses cheap x10, mid x5, high x4 and premium x2.5 multipliers from tier_override', () => {
    expect(getTierMultiplierForRate({ ...TOKENS_RATE, tierOverride: 'cheap' })).toBe(10);
    expect(getTierMultiplierForRate({ ...TOKENS_RATE, tierOverride: 'mid' })).toBe(5);
    expect(getTierMultiplierForRate({ ...TOKENS_RATE, tierOverride: 'high' })).toBe(4);
    expect(getTierMultiplierForRate({ ...TOKENS_RATE, tierOverride: 'premium' })).toBe(2.5);
  });

  it('computes provider base cost without legacy markup to avoid double charging', () => {
    const cost = computeBaseCostUsdFromRate(TOKENS_RATE, {
      kind: 'chat',
      providerCostUsd: 0.01,
      tokens: { inputTokens: 999_999, outputTokens: 999_999 },
    });

    expect(cost).toBeCloseTo(0.01, 6);
  });
});

describe('computeCostUsdFromRate — providerCostUsd (OpenRouter)', () => {
  it('prefers providerCostUsd × tier multiplier over token-rate math', () => {
    // OpenRouter reports cost=$0.01 directly; premium multiplier 2.5 → $0.025.
    // Token counts are irrelevant in this branch (OpenRouter already applied
    // cache discounts and upstream provider routing when computing cost).
    const cost = computeCostUsdFromRate(TOKENS_RATE, {
      kind: 'chat',
      providerCostUsd: 0.01,
      tokens: { inputTokens: 999_999, outputTokens: 999_999 },
    });
    expect(cost).toBeCloseTo(0.025, 6);
  });

  it('falls back to token-rate math when providerCostUsd is undefined', () => {
    const cost = computeCostUsdFromRate(TOKENS_RATE, {
      kind: 'chat',
      tokens: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
    });
    expect(cost).toBeCloseTo(75, 4);
  });

  it('falls back to token-rate math when providerCostUsd is negative', () => {
    // Negative cost is nonsense — ignore the value and compute from tokens.
    const cost = computeCostUsdFromRate(TOKENS_RATE, {
      kind: 'chat',
      providerCostUsd: -5,
      tokens: { inputTokens: 1_000_000, outputTokens: 0 },
    });
    expect(cost).toBeCloseTo(12.5, 4); // $5 × premium multiplier 2.5
  });

  it('handles zero providerCostUsd (e.g. free model) correctly', () => {
    // Zero is a valid cost (free tier). Token-rate math would otherwise
    // over-charge — so we respect the zero when explicitly provided.
    const cost = computeCostUsdFromRate(TOKENS_RATE, {
      kind: 'chat',
      providerCostUsd: 0,
      tokens: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
    });
    expect(cost).toBe(0);
  });
});

describe('computeCostUsdFromRate — image', () => {
  it('multiplies images by per_unit and tier multiplier', () => {
    // 5 × $0.04 × mid multiplier 5 = $1.00
    const cost = computeCostUsdFromRate(IMAGE_RATE, { kind: 'image', images: 5 });
    expect(cost).toBeCloseTo(1, 4);
  });

  it('defaults to 1 image if not provided', () => {
    const cost = computeCostUsdFromRate(IMAGE_RATE, { kind: 'image', images: undefined });
    expect(cost).toBeCloseTo(0.2, 4); // $0.04 × mid multiplier 5 × 1
  });
});

describe('computeCostUsdFromRate — second (video)', () => {
  it('multiplies seconds by per_unit and tier multiplier', () => {
    // 10 sec × $0.05 × mid multiplier 5 = $2.50
    const cost = computeCostUsdFromRate(VIDEO_RATE, { kind: 'video', videoSeconds: 10 });
    expect(cost).toBeCloseTo(2.5, 4);
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
