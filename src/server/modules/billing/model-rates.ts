// Per-model credit pricing — runtime values live in ai_aggregator.model_rates
// (Supabase). This module now only exports the global constants and the
// async credit calculator (reads rate from rates-source).

import { fetchRate } from '@/server/services/billing/rates-source';

import { computeCostUsdFromRate, type Usage } from './compute-cost';

// 1 credit = 0.15 RUB of API cost. Global constant, not model-specific.
export const CREDIT_VALUE_RUB = 0.15;

/**
 * Exchange rate for USD → RUB conversion.
 *
 * Read once at process start from `USD_TO_RUB` env var; defaults to 90
 * which approximates the May 2026 CBR rate. The previous hard-coded 100
 * over-charged every user by ~11% and inflated cost_rub by the same.
 *
 * TODO Phase 3: replace with a daily cron that fetches CBR
 * (`https://www.cbr-xml-daily.ru/daily_json.js` → `Valute.USD.Value`) and
 * stores the active rate in a small Supabase table. For now this env
 * lets an operator bump the rate quickly without code changes.
 *
 * `usage_logs.exchange_rate` keeps a per-row snapshot, so historical
 * rows remain accurate at whatever rate was active when they were
 * written.
 */
function readUsdToRub(): number {
  const raw = process.env.USD_TO_RUB;
  if (!raw) return 90;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 90;
}
export const USD_TO_RUB = readUsdToRub();

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
  // Free rate — admin set every priced field to zero (see /admin/finance/models
  // or the model_rates row). Return 0 instead of the usual 1-credit floor so
  // free local models (e.g. gemma4:e4b) actually charge nothing. Without this,
  // every "free" call still consumed 1 credit and the
  // billing-sanity-checks reconciliation check fired
  // ("credits charged but cost_usd <= 0"). The floor itself stays for the
  // unknown/no-rate path above — that's a real bug we want to keep catching.
  const isFreeRate =
    (rate.inputPer1M ?? 0) === 0 && (rate.outputPer1M ?? 0) === 0 && (rate.perUnit ?? 0) === 0;
  if (isFreeRate) return 0;
  const costUsd = computeCostUsdFromRate(rate, usage);
  const costRub = costUsd * USD_TO_RUB;
  return Math.max(1, Math.ceil(costRub / CREDIT_VALUE_RUB));
}
