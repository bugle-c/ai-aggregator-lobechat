import { usageLogs } from '@/database/schemas/analytics';
import { type LobeChatDatabase } from '@/database/type';
import {
  USD_TO_RUB,
  computeCostUsd,
  type TokenBreakdown,
} from '@/server/modules/billing/model-rates';

export interface WriteUsageLogInput {
  creditsCharged: number;
  inputTokens: number;
  outputTokens: number;
  cacheWrite5mTokens?: number;
  cacheWrite1hTokens?: number;
  cacheReadTokens?: number;
  kind: 'chat' | 'image' | 'video';
  model: string;
  provider: string;
  userId: string;
}

/**
 * Pure function: compute the row we'll insert. Cache-aware pricing via
 * computeCostUsd. Separated from the DB call so the math is unit-testable.
 */
export function computeUsageLogRow(input: WriteUsageLogInput) {
  const breakdown: TokenBreakdown = {
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    cacheWrite5mTokens: input.cacheWrite5mTokens ?? 0,
    cacheWrite1hTokens: input.cacheWrite1hTokens ?? 0,
    cacheReadTokens: input.cacheReadTokens ?? 0,
  };
  const costUsd = computeCostUsd(input.model, breakdown);
  const costRub = costUsd * USD_TO_RUB;

  return {
    userId: input.userId,
    model: input.model,
    provider: input.provider,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    cacheWrite5mTokens: breakdown.cacheWrite5mTokens ?? 0,
    cacheWrite1hTokens: breakdown.cacheWrite1hTokens ?? 0,
    cacheReadTokens: breakdown.cacheReadTokens ?? 0,
    creditsCharged: input.creditsCharged,
    costUsd: costUsd.toFixed(6),
    costRub: costRub.toFixed(4),
    exchangeRate: USD_TO_RUB.toFixed(4),
    kind: input.kind,
  };
}

export async function writeUsageLog(
  db: LobeChatDatabase,
  input: WriteUsageLogInput,
): Promise<void> {
  const row = computeUsageLogRow(input);
  try {
    await db.insert(usageLogs).values(row);
    console.info(
      `[analytics] usage_logs OK user=${input.userId} model=${input.model} credits=${input.creditsCharged} cost_usd=${row.costUsd}`,
    );
  } catch (error) {
    // Log full stack — we rely on this row for the monthly cost audit and
    // cannot silently swallow. DO still catch so chat response isn't broken.
    const msg = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
    console.error(
      `[analytics] usage_logs FAIL user=${input.userId} model=${input.model} credits=${input.creditsCharged}: ${msg}`,
    );
    console.error('[analytics] usage_logs row:', JSON.stringify(row));
  }
}
