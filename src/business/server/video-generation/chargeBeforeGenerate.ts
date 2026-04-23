import { getServerDB } from '@/database/core/db-adaptor';
import type { NewGeneration, NewGenerationBatch } from '@/database/schemas';
import { checkUsageLimit } from '@/server/modules/billing/checkUsageLimit';
import type { CreateVideoServicePayload } from '@/server/routers/lambda/video';
import { fetchRate } from '@/server/services/billing/rates-source';

interface ChargeParams {
  generationTopicId: string;
  model: string;
  params: CreateVideoServicePayload['params'];
  provider: string;
  userId: string;
}

interface ErrorBatch {
  data: {
    batch: NewGenerationBatch;
    generations: NewGeneration[];
  };
  success: true;
}

interface ChargeBeforeResult {
  errorBatch?: ErrorBatch;
  prechargeResult?: Record<string, unknown>;
}

export async function chargeBeforeGenerate(params: ChargeParams): Promise<ChargeBeforeResult> {
  const db = await getServerDB();

  const rate = await fetchRate(params.model);
  if (!rate || rate.modelId === '__default__' || rate.pricingUnit !== 'second') {
    throw new Error(
      `Model "${params.model}" is not configured for video generation. Admin: add it at /admin/finance/models.`,
    );
  }
  if (!rate.isActive) {
    throw new Error(`Model "${params.model}" is disabled.`);
  }

  const result = await checkUsageLimit(db, params.userId, params.model);
  if (!result.allowed) {
    console.warn(`[billing] Video generation blocked for user ${params.userId}: ${result.message}`);
    throw new Error(result.message || 'Usage limit exceeded');
  }

  return {};
}
