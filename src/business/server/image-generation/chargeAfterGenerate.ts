import { getServerDB } from '@/database/core/db-adaptor';
import { writeUsageLog } from '@/server/modules/analytics/writeUsageLog';
import { calculateCreditsAsync } from '@/server/modules/billing/model-rates';
import { BillingService } from '@/server/services/billing';
import { fetchRate } from '@/server/services/billing/rates-source';
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

  // Defense-in-depth: re-validate the model is still configured as an image model.
  // Mirrors chargeBeforeGenerate gate. If the before-gate passed and the after-gate
  // fails, something changed mid-generation (admin deactivated / deleted / switched
  // pricing_unit). Skip charge and log loudly to avoid silent 1-credit fallback.
  const rate = await fetchRate(params.metadata.modelId);
  if (!rate || rate.modelId === '__default__' || rate.pricingUnit !== 'image') {
    console.error(
      `[billing] chargeAfter: model=${params.metadata.modelId} no longer configured for image, skipping charge to avoid silent under-charge. user=${params.userId}`,
    );
    return;
  }

  const db = await getServerDB();
  const credits = await calculateCreditsAsync(params.metadata.modelId, {
    images: imageNum,
    kind: 'image',
  });

  await new BillingService(db, params.userId).incrementTokensUsed(credits);

  await writeUsageLog(db, {
    creditsCharged: credits,
    images: imageNum,
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
