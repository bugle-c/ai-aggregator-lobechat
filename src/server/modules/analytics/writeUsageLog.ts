import { usageLogs } from '@/database/schemas/analytics';
import { type LobeChatDatabase, type Transaction } from '@/database/type';
import {
  computeBaseCostUsdFromRate,
  computeCostUsdFromRate,
  getTierMultiplierForRate,
  type Usage,
} from '@/server/modules/billing/compute-cost';
import { CREDIT_VALUE_RUB, USD_TO_RUB } from '@/server/modules/billing/model-rates';
import type { HistoricalPricing } from '@/server/modules/billing/historical-pricing';
import { fetchRate } from '@/server/services/billing/rates-source';

export interface WriteUsageLogInput {
  cacheReadTokens?: number;
  cacheWrite1hTokens?: number;
  cacheWrite5mTokens?: number;
  creditsCharged: number;
  images?: number;
  inputTokens: number;
  kind: 'chat' | 'image' | 'video';
  model: string;
  outputTokens: number;
  provider: string;
  /**
   * Provider-reported cost in USD (e.g. OpenRouter `response.usage.cost`).
   * Chat: threaded through to computeCostUsdFromRate so usage_logs.cost_usd
   * reflects the actual provider charge × markup rather than a re-derivation
   * from token counts.
   * Image/video: overrides `provider_cost_rub` only — what the user is charged
   * (`cost_usd`/`cost_rub`) still follows the catalog rate. Pass `0` for
   * results served by our llm-router subscription pool.
   */
  providerCostUsd?: number;
  providerRequestId?: string;
  providerCostSource?: string;
  providerCostEvidence?: Record<string, unknown>;
  userId: string;
  videoSeconds?: number;
}

/**
 * Pure function: compute the row we'll insert. Cache-aware pricing via
 * rates-source + compute-cost. Separated from the DB call so the math is
 * unit-testable.
 */
export async function computeUsageLogRow(input: WriteUsageLogInput) {
  if (input.providerCostUsd !== undefined &&
      (!Number.isFinite(input.providerCostUsd) || input.providerCostUsd < 0)) {
    throw new Error('providerCostUsd must be a finite nonnegative upstream amount');
  }
  const rate = await fetchRate(input.model);
  let usage: Usage;
  if (input.kind === 'image') {
    usage = { kind: 'image', images: input.images ?? 1 };
  } else if (input.kind === 'video') {
    usage = { kind: 'video', videoSeconds: input.videoSeconds ?? 0 };
  } else {
    usage = {
      kind: 'chat',
      providerCostUsd: input.providerCostUsd,
      tokens: {
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        cacheWrite5mTokens: input.cacheWrite5mTokens ?? 0,
        cacheWrite1hTokens: input.cacheWrite1hTokens ?? 0,
        cacheReadTokens: input.cacheReadTokens ?? 0,
      },
    };
  }
  const costUsd = rate ? computeCostUsdFromRate(rate, usage) : 0;
  const costRub = costUsd * USD_TO_RUB;
  // Legacy RUB expense is an estimate unless actualProviderCostUsd is present.
  // Financial reporting must use verified actual USD and show unresolved estimates separately.
  const providerCostUsd =
    input.kind !== 'chat' && typeof input.providerCostUsd === 'number' && input.providerCostUsd >= 0
      ? input.providerCostUsd
      : rate
        ? computeBaseCostUsdFromRate(rate, usage)
        : 0;
  const providerCostRub = providerCostUsd * USD_TO_RUB;

  return {
    userId: input.userId,
    model: input.model,
    provider: input.provider,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    cacheWrite5mTokens: input.cacheWrite5mTokens ?? 0,
    cacheWrite1hTokens: input.cacheWrite1hTokens ?? 0,
    cacheReadTokens: input.cacheReadTokens ?? 0,
    creditsCharged: input.creditsCharged,
    costUsd: costUsd.toFixed(6),
    costRub: costRub.toFixed(4),
    providerCostRub: providerCostRub.toFixed(4),
    actualProviderCostUsd: input.providerCostUsd === undefined ? null : String(input.providerCostUsd),
    providerRequestId: input.providerRequestId ?? null,
    providerCostStatus: input.providerCostUsd !== undefined ? 'verified' : input.providerRequestId ? 'pending' : 'unknown',
    providerCostSource: input.providerCostUsd === undefined ? null : input.providerCostSource ?? 'upstream_usage',
    providerCostEvidence: {
      ...input.providerCostEvidence,
      historicalPricing: input.providerCostEvidence?.historicalPricing ?? (rate ? {
        source: 'usage_log_rate_snapshot',
        sourceReference: `model_rates:${input.model}`,
        capturedAt: new Date().toISOString(),
        markup: getTierMultiplierForRate(rate),
        exchangeRate: USD_TO_RUB,
        creditValueRub: CREDIT_VALUE_RUB,
        minimumCredits: 1,
        zeroCostCredits: 0,
        rounding: 'ceil',
        rate,
        loggedCreditsCharged: input.creditsCharged,
        // A writer-time snapshot does not prove an earlier reservation used it.
        captureStage: 'usage_log_write',
      } satisfies HistoricalPricing & { rate: typeof rate; loggedCreditsCharged: number } : null),
    },
    providerCostReconciledAt: input.providerCostUsd === undefined ? null : new Date(),
    exchangeRate: USD_TO_RUB.toFixed(4),
    kind: input.kind,
  };
}

/**
 * Insert a usage_logs row. Throws on failure — the caller MUST handle the
 * error (either by rolling back the sibling credit allocation via a
 * shared transaction, or by explicitly deciding the log can be lost).
 *
 * Historical note: this function used to swallow insert errors so the chat
 * response wouldn't break. That created "phantom credits" — the monthly
 * counter incremented but no usage_logs row existed, so the cost audit
 * under-counted real spend while users appeared to owe money we couldn't
 * justify. 2025-H2 audit found 18/49 users affected, ~1090 stray credits
 * total. Now all call sites wrap both operations in db.transaction.
 */
export async function writeUsageLog(
  db: LobeChatDatabase | Transaction,
  input: WriteUsageLogInput,
): Promise<void> {
  const row = await computeUsageLogRow(input);
  await db.insert(usageLogs).values(row);
  console.info(
    `[analytics] usage_logs OK user=${input.userId} model=${input.model} credits=${input.creditsCharged} cost_usd=${row.costUsd}`,
  );
}
