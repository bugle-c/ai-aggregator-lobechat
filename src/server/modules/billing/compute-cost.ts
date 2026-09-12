/**
 * Pure billing math. No side effects, no DB, no network — just arithmetic.
 * Isolated for testability and so the rest of the codebase can depend on it
 * without pulling in rates-source.
 */

import type { RateView } from '@/server/services/billing/rates-source';

export type { RateView };

export type ModelTier = 'cheap' | 'mid' | 'high' | 'premium';

/**
 * Business markup on top of provider cost, per tier. Flattened 2026-09-12 by
 * owner decision after the pricing audit (docs/superpowers/research/
 * 2026-09-12-pricing-audit.md): the old ladder (cheap ×10 … premium ×2.5)
 * made the cheap models Free/Basic users actually use the most expensive
 * ones relative to cost (~2.5× above market per message) and video ~4×
 * above market; premium stays at ×2.5.
 */
export const TIER_MARKUP_MULTIPLIER: Record<ModelTier, number> = {
  cheap: 4,
  mid: 4,
  high: 3,
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
  /**
   * Requested output resolution ('480p' | '720p' | '1080p' | '4k'). Scales the
   * per-second rate for families priced per resolution (see
   * `RESOLUTION_PRICE_FACTORS`); omitted / unknown → the 720p baseline (×1).
   */
  resolution?: string | null;
  videoSeconds: number;
}
export type Usage = ChatUsage | ImageUsage | VideoUsage;

/**
 * Per-resolution price factors relative to the 720p rate stored in
 * `model_rates.per_unit`, keyed by model-id prefix. WaveSpeed prices the whole
 * Seedance 2.0 family this way (Mini / Fast / full, t2v and i2v alike):
 * 480p $0.10 · 720p $0.20 · 1080p $0.50 · 4k $1.00 per second for Fast.
 * Families not listed here are flat per second (factor 1).
 */
export const RESOLUTION_PRICE_FACTORS: Record<string, Record<string, number>> = {
  'bytedance/seedance-2.0': { '1080p': 2.5, '480p': 0.5, '4k': 5, '720p': 1 },
};

/** Provider cap on the combined (normalized) reference-video input, seconds. */
export const MAX_REFERENCE_SECONDS = 15;

/**
 * Billable seconds contributed by reference videos (Seedance 2.0 Mini / full
 * bill their normalized input at the output per-second rate). The client
 * measures the clips when attaching them; the server only clamps. Reference
 * videos present but no usable measurement → the provider cap, so a missing
 * or zeroed value can never under-bill.
 */
export function referenceSecondsFor(params: {
  referenceSeconds?: number | null;
  videoUrls?: readonly unknown[] | null;
}): number {
  const hasVideos = Array.isArray(params.videoUrls) && params.videoUrls.length > 0;
  if (!hasVideos) return 0;
  const measured = Number(params.referenceSeconds);
  if (!Number.isFinite(measured) || measured <= 0) return MAX_REFERENCE_SECONDS;
  return Math.min(MAX_REFERENCE_SECONDS, Math.ceil(measured));
}

export function videoResolutionFactor(modelId: string, resolution?: string | null): number {
  if (!resolution) return 1;
  const family = Object.keys(RESOLUTION_PRICE_FACTORS).find((prefix) => modelId.startsWith(prefix));
  if (!family) return 1;
  return RESOLUTION_PRICE_FACTORS[family][resolution.toLowerCase()] ?? 1;
}

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
  // Per-model markupOverride wins over the tier-derived multiplier. Used to
  // expose "wow-price" hero models (e.g. DeepSeek V4 Flash at ×2 in the Free
  // tier) without shoving them into a lower tier bucket that would also
  // change their plan-visibility gate.
  if (rate.markupOverride !== null && rate.markupOverride > 0) {
    return rate.markupOverride;
  }
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
    return usage.videoSeconds * perUnit * videoResolutionFactor(rate.modelId, usage.resolution);
  }
  // Mismatch — don't silently mis-charge; return 0 and caller must have rejected earlier.
  return 0;
}

export function computeCostUsdFromRate(rate: RateView, usage: Usage): number {
  return computeBaseCostUsdFromRate(rate, usage) * getTierMultiplierForRate(rate);
}
