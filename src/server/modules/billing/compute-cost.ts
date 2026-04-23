/**
 * Pure billing math. No side effects, no DB, no network — just arithmetic.
 * Isolated for testability and so the rest of the codebase can depend on it
 * without pulling in rates-source.
 */

import type { RateView } from '@/server/services/billing/rates-source';

export type { RateView };

export interface ChatUsage {
  kind: 'chat';
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

export function computeCostUsdFromRate(rate: RateView, usage: Usage): number {
  if (rate.pricingUnit === 'tokens' && usage.kind === 'chat') {
    const inPer1M = rate.inputPer1M ?? 0;
    const outPer1M = rate.outputPer1M ?? 0;
    const t = usage.tokens;
    const baseCost =
      (t.inputTokens / 1_000_000) * inPer1M +
      ((t.cacheWrite5mTokens ?? 0) / 1_000_000) * inPer1M * 1.25 +
      ((t.cacheWrite1hTokens ?? 0) / 1_000_000) * inPer1M * 2 +
      ((t.cacheReadTokens ?? 0) / 1_000_000) * inPer1M * 0.1 +
      (t.outputTokens / 1_000_000) * outPer1M;
    return baseCost * rate.markup;
  }
  if (rate.pricingUnit === 'image' && usage.kind === 'image') {
    const perUnit = rate.perUnit ?? 0;
    return (usage.images ?? 1) * perUnit * rate.markup;
  }
  if (rate.pricingUnit === 'second' && usage.kind === 'video') {
    const perUnit = rate.perUnit ?? 0;
    return usage.videoSeconds * perUnit * rate.markup;
  }
  // Mismatch — don't silently mis-charge; return 0 and caller must have rejected earlier.
  return 0;
}
