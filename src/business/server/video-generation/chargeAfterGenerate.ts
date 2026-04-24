import { getServerDB } from '@/database/core/db-adaptor';
import { writeUsageLog } from '@/server/modules/analytics/writeUsageLog';
import { calculateCreditsAsync } from '@/server/modules/billing/model-rates';
import { BillingService } from '@/server/services/billing';
import { fetchRate } from '@/server/services/billing/rates-source';

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

  // Defense-in-depth: re-validate the model is still configured as a video model.
  // Mirrors chargeBeforeGenerate gate. If the before-gate passed and the after-gate
  // fails, something changed mid-generation (admin deactivated / deleted / switched
  // pricing_unit). Skip charge and log loudly to avoid silent 1-credit fallback.
  const rate = await fetchRate(params.metadata.modelId);
  if (!rate || rate.modelId === '__default__' || rate.pricingUnit !== 'second') {
    console.error(
      `[billing] chargeAfter: model=${params.metadata.modelId} no longer configured for second, skipping charge to avoid silent under-charge. user=${params.userId}`,
    );
    return;
  }

  const db = await getServerDB();
  const credits = await calculateCreditsAsync(params.metadata.modelId, {
    kind: 'video',
    videoSeconds: seconds,
  });

  const billingService = new BillingService(db, params.userId);

  // Atomic: increment + log. Same reasoning as recordTokenUsage — if the log
  // insert fails we must roll back the increment, otherwise phantom credits.
  try {
    await db.transaction(async (tx) => {
      await billingService.incrementTokensUsed(credits, tx);
      await writeUsageLog(tx, {
        creditsCharged: credits,
        inputTokens: 0,
        kind: 'video',
        model: params.metadata.modelId,
        outputTokens: 0,
        provider: params.provider || 'unknown',
        userId: params.userId,
        videoSeconds: seconds,
      });
    });
  } catch (error) {
    const msg = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
    console.error(
      `[billing] video charge transaction failed — rolled back. user=${params.userId} model=${params.metadata.modelId}: ${msg}`,
    );
    return;
  }

  console.info(
    `[billing] video charged ${credits} credits: user=${params.userId} model=${params.metadata.modelId} seconds=${seconds}`,
  );
}
