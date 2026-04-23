import { getServerDB } from '@/database/core/db-adaptor';
import { writeUsageLog } from '@/server/modules/analytics/writeUsageLog';
import { calculateCreditsAsync } from '@/server/modules/billing/model-rates';
import { BillingService } from '@/server/services/billing';

interface ChargeParams {
  computePriceParams?: { generateAudio?: boolean };
  isError?: boolean;
  latency?: number;
  metadata: {
    asyncTaskId: string;
    generationBatchId: string;
    modelId: string;
    topicId?: string;
  };
  model: string;
  prechargeResult?: Record<string, unknown>;
  provider: string;
  // Video: use durationSeconds from provider webhook if available, else fall back
  // to duration in modelUsage, else 0 (no charge, but we log it).
  usage?: { completionTokens: number; durationSeconds?: number; totalTokens: number };
  userId: string;
}

export async function chargeAfterGenerate(params: ChargeParams): Promise<void> {
  if (params.isError) return;

  const seconds = params.usage?.durationSeconds ?? 0;
  if (seconds <= 0) {
    console.warn(
      `[billing] video chargeAfter: no durationSeconds for model=${params.metadata.modelId}, skipping charge`,
    );
    return;
  }

  const db = await getServerDB();
  const credits = await calculateCreditsAsync(params.metadata.modelId, {
    kind: 'video',
    videoSeconds: seconds,
  });

  await new BillingService(db, params.userId).incrementTokensUsed(credits);

  await writeUsageLog(db, {
    creditsCharged: credits,
    inputTokens: 0,
    kind: 'video',
    model: params.metadata.modelId,
    outputTokens: 0,
    provider: params.provider || 'unknown',
    userId: params.userId,
  });

  console.info(
    `[billing] video charged ${credits} credits: user=${params.userId} model=${params.metadata.modelId} seconds=${seconds}`,
  );
}
