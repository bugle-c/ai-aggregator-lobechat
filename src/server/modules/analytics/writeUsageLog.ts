import { usageLogs } from '@/database/schemas/analytics';
import { type LobeChatDatabase, type Transaction } from '@/database/type';
import {
  computeBaseCostUsdFromRate,
  computeCostUsdFromRate,
  type Usage,
} from '@/server/modules/billing/compute-cost';
import { USD_TO_RUB } from '@/server/modules/billing/model-rates';
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
   * When present, threaded through to computeCostUsdFromRate for chat usage
   * so usage_logs.cost_usd reflects the actual provider charge × markup
   * rather than a re-derivation from token counts.
   */
  providerCostUsd?: number;
  userId: string;
  videoSeconds?: number;
}

/**
 * Pure function: compute the row we'll insert. Cache-aware pricing via
 * rates-source + compute-cost. Separated from the DB call so the math is
 * unit-testable.
 */
export async function computeUsageLogRow(input: WriteUsageLogInput) {
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
  // provider_cost_rub stores what we actually pay the upstream API,
  // BEFORE the tier markup we apply on top to compute credits. The
  // Economics page reads this for true gross-margin math; cost_rub
  // stays the "charged value" reported to the user. Local Ollama
  // models (rate present but per_unit=0) naturally land at 0.
  const providerCostUsd = rate ? computeBaseCostUsdFromRate(rate, usage) : 0;
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
    exchangeRate: USD_TO_RUB.toFixed(4),
    kind: input.kind,
  };
}

/**
 * Insert a usage_logs row. Throws on failure — the caller MUST handle the
 * error (either by rolling back the sibling `incrementTokensUsed` via a
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
