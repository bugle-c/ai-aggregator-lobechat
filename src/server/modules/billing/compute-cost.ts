/**
 * Pure billing math. No side effects, no DB, no network — just arithmetic.
 * Isolated for testability and so the rest of the codebase can depend on it
 * without pulling in rates-source.
 */

import type { RateView } from '@/server/services/billing/rates-source';

export type { RateView };

export type ModelTier = 'cheap' | 'mid' | 'high' | 'premium';

export const TIER_MARKUP_MULTIPLIER: Record<ModelTier, number> = {
  cheap: 10,
  mid: 5,
  high: 4,
  premium: 2.5,
};

export interface ChatUsage {
  kind: 'chat';
  /**
   * Provider-reported cost in USD (e.g. `response.usage.cost` from OpenRouter).
   * When present, base-cost math skips token-rate math and uses this value as
   * the pre-markup provider cost. Preferred for OpenRouter because it already
   * reflects actual underlying provider, cache discounts, and volume tiers.
   */
  providerCostUsd?: number;
  tokens: {
    cacheReadTokens?: number;
    cacheWrite1hTokens?: number;
    cacheWrite5mTokens?: number;
    inputTokens: number;
    outputTokens: number;
  };
}
export interface ImageUsage {
  images?: number; // default 1
  kind: 'image';
}
export interface VideoUsage {
  kind: 'video';
  videoSeconds: number;
}
export type Usage = ChatUsage | ImageUsage | VideoUsage;

/**
 * Classify a rate from raw provider price (pre-markup). The thresholds are the
 * old marked-up thresholds divided by the legacy markup of 3, so existing DB
 * rows keep roughly the same tier until admins set `tier_override` explicitly.
 */
export function classifyTierFromRate(rate: RateView): ModelTier {
  if (rate.tierOverride) return rate.tierOverride;
  if (rate.pricingUnit === 'tokens') {
    const out = rate.outputPer1M ?? 0;
    if (out <= 1) return 'cheap';
    if (out <= 5) return 'mid';
    if (out <= 15) return 'high';
    return 'premium';
  }
  if (rate.pricingUnit === 'image') {
    const u = rate.perUnit ?? 0;
    if (u <= 0.01) return 'cheap';
    if (u <= 0.05) return 'mid';
    if (u <= 0.2) return 'high';
    return 'premium';
  }
  const u = rate.perUnit ?? 0;
  if (u <= 0.02) return 'cheap';
  if (u <= 0.1) return 'mid';
  if (u <= 0.4) return 'high';
  return 'premium';
}

export function getTierMultiplierForRate(rate: RateView): number {
  return TIER_MARKUP_MULTIPLIER[classifyTierFromRate(rate)];
}

/** Provider cost before business markup. */
export function computeBaseCostUsdFromRate(rate: RateView, usage: Usage): number {
  if (rate.pricingUnit === 'tokens' && usage.kind === 'chat') {
    // Prefer provider-reported cost when available (OpenRouter emits `usage.cost`
    // in USD, already covering cache discounts and upstream provider routing).
    if (typeof usage.providerCostUsd === 'number' && usage.providerCostUsd >= 0) {
      return usage.providerCostUsd;
    }
    const inPer1M = rate.inputPer1M ?? 0;
    const outPer1M = rate.outputPer1M ?? 0;
    const t = usage.tokens;
    return (
      (t.inputTokens / 1_000_000) * inPer1M +
      ((t.cacheWrite5mTokens ?? 0) / 1_000_000) * inPer1M * 1.25 +
      ((t.cacheWrite1hTokens ?? 0) / 1_000_000) * inPer1M * 2 +
      ((t.cacheReadTokens ?? 0) / 1_000_000) * inPer1M * 0.1 +
      (t.outputTokens / 1_000_000) * outPer1M
    );
  }
  if (rate.pricingUnit === 'image' && usage.kind === 'image') {
    const perUnit = rate.perUnit ?? 0;
    return (usage.images ?? 1) * perUnit;
  }
  if (rate.pricingUnit === 'second' && usage.kind === 'video') {
    const perUnit = rate.perUnit ?? 0;
    return usage.videoSeconds * perUnit;
  }
  // Mismatch — don't silently mis-charge; return 0 and caller must have rejected earlier.
  return 0;
}

export function computeCostUsdFromRate(rate: RateView, usage: Usage): number {
  return computeBaseCostUsdFromRate(rate, usage) * getTierMultiplierForRate(rate);
}
