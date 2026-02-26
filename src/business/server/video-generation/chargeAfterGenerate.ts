import { getServerDB } from '@/database/core/db-adaptor';
import { recordTokenUsage } from '@/server/modules/billing/checkUsageLimit';

interface ChargeParams {
  computePriceParams?: { generateAudio?: boolean };
  isError?: boolean;
  /** Total time from task submission to webhook callback (ms) */
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
  usage?: { completionTokens: number; totalTokens: number };
  userId: string;
}

export async function chargeAfterGenerate(params: ChargeParams): Promise<void> {
  if (params.isError) return;

  const totalTokens = params.usage?.totalTokens || 0;
  if (totalTokens > 0) {
    const db = await getServerDB();
    await recordTokenUsage(db, params.userId, totalTokens);
  }
}
