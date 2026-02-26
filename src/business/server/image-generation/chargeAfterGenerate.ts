import { getServerDB } from '@/database/core/db-adaptor';
import { recordTokenUsage } from '@/server/modules/billing/checkUsageLimit';
import { type ModelPerformance, type ModelUsage } from '@/types/index';

interface ChargeParams {
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
  const totalTokens = params.modelUsage?.totalTokens || 0;
  if (totalTokens > 0) {
    const db = await getServerDB();
    await recordTokenUsage(db, params.userId, totalTokens);
  }
}
