// Per-model credit pricing — runtime values live in ai_aggregator.model_rates
// (Supabase). This module now only exports the global constants and the
// async credit calculator (reads rate from rates-source).

import { fetchRate } from '@/server/services/billing/rates-source';

import { computeCostUsdFromRate, type Usage } from './compute-cost';

// 1 credit = 0.15 RUB of API cost. Global constant, not model-specific.
export const CREDIT_VALUE_RUB = 0.15;

// Exchange rate for USD → RUB conversion. Global constant.
export const USD_TO_RUB = 100;

/**
 * Unit-aware credit calculator. Pulls rate from Supabase-backed cache,
 * computes USD cost with markup, converts to credits.
 */
export async function calculateCreditsAsync(modelId: string, usage: Usage): Promise<number> {
  const rate = await fetchRate(modelId);
  if (!rate) {
    console.warn(`[billing] no rate for model=${modelId}, charging 1 credit floor`);
    return 1;
  }
  const costUsd = computeCostUsdFromRate(rate, usage);
  const costRub = costUsd * USD_TO_RUB;
  return Math.max(1, Math.ceil(costRub / CREDIT_VALUE_RUB));
}
