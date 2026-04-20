import { usageLogs } from '@/database/schemas/analytics';
import { type LobeChatDatabase } from '@/database/type';
import { getModelRate, USD_TO_RUB } from '@/server/modules/billing/model-rates';

export interface WriteUsageLogInput {
  creditsCharged: number;
  inputTokens: number;
  kind: 'chat' | 'image' | 'video';
  model: string;
  outputTokens: number;
  provider: string;
  userId: string;
}

/**
 * Pure function: compute the row we'll insert. Kept separate from DB call
 * so the cost math is testable without a database.
 */
export function computeUsageLogRow(input: WriteUsageLogInput) {
  const rate = getModelRate(input.model);
  const costUsd =
    (input.inputTokens / 1_000_000) * rate.inputPer1M +
    (input.outputTokens / 1_000_000) * rate.outputPer1M;
  const exchangeRate = USD_TO_RUB;
  const costRub = costUsd * exchangeRate;

  return {
    userId: input.userId,
    model: input.model,
    provider: input.provider,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    creditsCharged: input.creditsCharged,
    costUsd: costUsd.toFixed(6),
    costRub: costRub.toFixed(4),
    exchangeRate: exchangeRate.toFixed(4),
    kind: input.kind,
  };
}

export async function writeUsageLog(
  db: LobeChatDatabase,
  input: WriteUsageLogInput,
): Promise<void> {
  try {
    const row = computeUsageLogRow(input);
    await db.insert(usageLogs).values(row);
  } catch (error) {
    console.error('[analytics] writeUsageLog error:', error);
    // Swallow — never break the chat response because of telemetry write.
  }
}
