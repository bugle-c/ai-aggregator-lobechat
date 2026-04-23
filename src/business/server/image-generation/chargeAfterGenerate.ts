import { getServerDB } from '@/database/core/db-adaptor';
import { writeUsageLog } from '@/server/modules/analytics/writeUsageLog';
import { calculateCreditsAsync } from '@/server/modules/billing/model-rates';
import { BillingService } from '@/server/services/billing';
import { type ModelPerformance, type ModelUsage } from '@/types/index';

interface ChargeParams {
  imageNum?: number;
  metadata: {
    asyncTaskId: string;
    generationBatchId: string;
    modelId: string;
    topicId?: string;
  };
  metrics?: ModelPerformance;
  modelUsage?: ModelUsage;
  provider: string;
  userId: string;
}

export async function chargeAfterGenerate(params: ChargeParams): Promise<void> {
  const imageNum = params.imageNum ?? 1;
  if (imageNum <= 0) return;

  const db = await getServerDB();
  const credits = await calculateCreditsAsync(params.metadata.modelId, {
    images: imageNum,
    kind: 'image',
  });

  await new BillingService(db, params.userId).incrementTokensUsed(credits);

  await writeUsageLog(db, {
    creditsCharged: credits,
    inputTokens: 0,
    kind: 'image',
    model: params.metadata.modelId,
    outputTokens: 0,
    provider: params.provider || 'unknown',
    userId: params.userId,
  });

  console.info(
    `[billing] image charged ${credits} credits: user=${params.userId} model=${params.metadata.modelId} images=${imageNum}`,
  );
}
