import { getServerDB } from '@/database/core/db-adaptor';
import { type NewGeneration, type NewGenerationBatch } from '@/database/schemas';
import { checkUsageLimit } from '@/server/modules/billing/checkUsageLimit';
import { type CreateImageServicePayload } from '@/server/routers/lambda/image';
import { fetchRate } from '@/server/services/billing/rates-source';

interface ChargeParams {
  clientIp?: string | null;
  configForDatabase: CreateImageServicePayload['params'];
  generationParams: CreateImageServicePayload['params'];
  generationTopicId: string;
  imageNum: number;
  model: string;
  provider: string;
  userId: string;
}

type ChargeResult =
  | undefined
  | {
      data: {
        batch: NewGenerationBatch;
        generations: NewGeneration[];
      };
      success: true;
    };

export async function chargeBeforeGenerate(params: ChargeParams): Promise<ChargeResult> {
  const db = await getServerDB();

  // Strict mode: image model must have an explicit row with pricing_unit='image'.
  // Never fall through to __default__ (token pricing can't bill per-image).
  const rate = await fetchRate(params.model);
  if (!rate || rate.modelId === '__default__' || rate.pricingUnit !== 'image') {
    throw new Error(
      `Model "${params.model}" is not configured for image generation. Admin: add it at /admin/finance/models.`,
    );
  }
  if (!rate.isActive) {
    throw new Error(`Model "${params.model}" is disabled.`);
  }

  const result = await checkUsageLimit(db, params.userId, params.model);
  if (!result.allowed) {
    console.warn(`[billing] Image generation blocked for user ${params.userId}: ${result.message}`);
    throw new Error(result.message || 'Usage limit exceeded');
  }

  return undefined;
}
