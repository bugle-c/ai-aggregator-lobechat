/**
 * Finishing a router-rendered video — shared by the async procedure
 * (`async/video.ts`) and the `poll-stuck-video-jobs` cron, which takes over
 * when the container was recreated while the procedure was still polling
 * (deploys do that daily). Mirrors what the WaveSpeed webhook does on
 * success: asset + file, task Success, `chargeAfterGenerate` with
 * `served: llm-router` (provider cost 0, user pays the catalog price).
 */
import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import {
  AsyncTaskError,
  AsyncTaskErrorType,
  AsyncTaskStatus,
  FileSource,
  type VideoGenerationAsset,
} from '@lobechat/types';
import { type RuntimeVideoGenParams } from 'model-bank';

import { chargeAfterGenerate } from '@/business/server/video-generation/chargeAfterGenerate';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { GenerationModel } from '@/database/models/generation';
import { GenerationBatchModel } from '@/database/models/generationBatch';
import { type LobeChatDatabase } from '@/database/type';
import { referenceSecondsFor } from '@/server/modules/billing/compute-cost';
import { VideoGenerationService } from '@/server/services/generation/video';
import { sanitizeFileName } from '@/utils/sanitizeFileName';

import { ROUTER_PROVIDER_ID } from './config';

export interface RouterVideoTaskRef {
  asyncTaskId: string;
  generationBatchId: string;
  generationId: string;
  generationTopicId?: string;
  model: string;
  prechargeResult?: Record<string, unknown>;
  provider: string;
  userId: string;
}

/** Copy shown when a router video cannot be finished (task → Error, hold refunded). */
export const ROUTER_VIDEO_FAILED_MESSAGE =
  'Не удалось завершить видео. Кредиты возвращены — попробуйте ещё раз.';

export async function finalizeRouterVideoSuccess(
  db: LobeChatDatabase,
  ref: RouterVideoTaskRef,
  opts: {
    baseMeta: Record<string, unknown>;
    buffer: Buffer;
    jobId?: string;
    /** Seconds the hold was taken for — never bill more than this. */
    requestedSeconds: number;
    taskCreatedAt: Date;
  },
): Promise<void> {
  const asyncTaskModel = new AsyncTaskModel(db, ref.userId);
  const generationModel = new GenerationModel(db, ref.userId);
  const batchModel = new GenerationBatchModel(db, ref.userId);
  const videoService = new VideoGenerationService(db, ref.userId);

  const processed = await videoService.processVideoForGeneration({ buffer: opts.buffer });
  const batch = await batchModel.findById(ref.generationBatchId);
  const prompt = batch?.prompt ?? '';
  const asset: VideoGenerationAsset = {
    coverUrl: processed.coverKey,
    duration: processed.duration,
    height: processed.height,
    originalUrl: processed.videoKey,
    thumbnailUrl: processed.thumbnailKey,
    type: 'video',
    url: processed.videoKey,
    width: processed.width,
  };
  await generationModel.createAssetAndFile(
    ref.generationId,
    asset,
    {
      fileHash: processed.fileHash,
      fileType: processed.mimeType,
      name: `${sanitizeFileName(prompt, ref.generationId)}.mp4`,
      size: processed.fileSize,
      url: processed.videoKey,
    },
    FileSource.VideoGeneration,
  );
  const duration = Date.now() - opts.taskCreatedAt.getTime();
  await asyncTaskModel.update(ref.asyncTaskId, {
    duration,
    metadata: {
      ...opts.baseMeta,
      actualSeconds: processed.duration,
      routerJobId: opts.jobId,
      servedBy: ROUTER_PROVIDER_ID,
    },
    status: AsyncTaskStatus.Success,
  });

  if (ENABLE_BUSINESS_FEATURES) {
    const batchConfig = (batch?.config ?? {}) as RuntimeVideoGenParams;
    const billedSeconds = Math.min(
      opts.requestedSeconds,
      processed.duration || opts.requestedSeconds,
    );
    await chargeAfterGenerate({
      computePriceParams: { generateAudio: batchConfig.generateAudio },
      latency: duration,
      metadata: {
        asyncTaskId: ref.asyncTaskId,
        generationBatchId: ref.generationBatchId,
        modelId: ref.model,
        topicId: ref.generationTopicId,
      },
      model: ref.model,
      prechargeResult: ref.prechargeResult as any,
      provider: ref.provider,
      referenceSeconds: referenceSecondsFor(
        (batchConfig ?? {}) as { referenceSeconds?: number; videoUrls?: unknown[] },
      ),
      resolution: typeof batchConfig.resolution === 'string' ? batchConfig.resolution : undefined,
      served: { provider: ROUTER_PROVIDER_ID, providerCostUsd: 0 },
      usage: { completionTokens: 0, durationSeconds: billedSeconds, totalTokens: 0 },
      userId: ref.userId,
    });
  }
}

/** Task → Error with a customer-safe message, hold refunded. */
export async function failRouterVideo(
  db: LobeChatDatabase,
  ref: RouterVideoTaskRef,
  opts: { baseMeta: Record<string, unknown>; message: string; reason: string },
): Promise<void> {
  const asyncTaskModel = new AsyncTaskModel(db, ref.userId);
  await asyncTaskModel.update(ref.asyncTaskId, {
    error: new AsyncTaskError(AsyncTaskErrorType.ServerError, opts.message),
    metadata: { ...opts.baseMeta, routerFallbackReason: opts.reason, servedBy: 'none' },
    status: AsyncTaskStatus.Error,
  });
  if (ENABLE_BUSINESS_FEATURES && ref.prechargeResult) {
    try {
      await chargeAfterGenerate({
        isError: true,
        metadata: {
          asyncTaskId: ref.asyncTaskId,
          generationBatchId: ref.generationBatchId,
          modelId: ref.model,
          topicId: ref.generationTopicId,
        },
        model: ref.model,
        prechargeResult: ref.prechargeResult as any,
        provider: ref.provider,
        userId: ref.userId,
      });
    } catch (chargeError) {
      console.error('[media-router] refund after router video failure:', chargeError);
    }
  }
}
