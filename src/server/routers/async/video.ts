/**
 * Async video generation through our llm-router pool (router-first).
 *
 * `createVideo` (lambda) has already taken the credit hold and created the
 * batch / generation / asyncTask. This procedure submits the clip to the
 * router with `async:true`, polls until the deadline, and on success finishes
 * the task exactly like the WaveSpeed webhook would (asset, file, Success,
 * chargeAfterGenerate — with `served: llm-router`, so `provider_cost_rub` is 0
 * while the user pays the catalog price). On any failure it falls back to the
 * regular WaveSpeed submission with the same asyncTask and webhook token, so
 * the user only notices a longer wait.
 *
 * Design: docs/superpowers/specs/2026-09-22-router-first-media-routing-design.md
 */
import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import {
  AsyncTaskError,
  AsyncTaskErrorType,
  AsyncTaskStatus,
  FileSource,
  type VideoGenerationAsset,
} from '@lobechat/types';
import debug from 'debug';
import { eq } from 'drizzle-orm';
import { type RuntimeVideoGenParams } from 'model-bank';
import { z } from 'zod';

import { recordRouterOutcome } from '@/business/server/media-router/breaker';
import { releaseVideoSlot } from '@/business/server/media-router/budget';
import {
  generateViaRouter,
  looksLikeMp4,
  submitRouterVideo,
} from '@/business/server/media-router/client';
import { getMediaRouterConfig, ROUTER_PROVIDER_ID } from '@/business/server/media-router/config';
import { type VideoRoute } from '@/business/server/media-router/eligibility';
import { chargeAfterGenerate } from '@/business/server/video-generation/chargeAfterGenerate';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { GenerationModel } from '@/database/models/generation';
import { GenerationBatchModel } from '@/database/models/generationBatch';
import { asyncTasks } from '@/database/schemas';
import { appEnv } from '@/envs/app';
import { asyncAuthedProcedure, asyncRouter as router } from '@/libs/trpc/async';
import { referenceSecondsFor } from '@/server/modules/billing/compute-cost';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { VideoGenerationService } from '@/server/services/generation/video';
import { sanitizeFileName } from '@/utils/sanitizeFileName';

const log = debug('lobe-video:async:router');

const videoProcedure = asyncAuthedProcedure.use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      asyncTaskModel: new AsyncTaskModel(ctx.serverDB, ctx.userId),
      generationBatchModel: new GenerationBatchModel(ctx.serverDB, ctx.userId),
      generationModel: new GenerationModel(ctx.serverDB, ctx.userId),
    },
  });
});

const createViaRouterInput = z.object({
  asyncTaskId: z.string(),
  generationBatchId: z.string(),
  generationId: z.string(),
  generationTopicId: z.string(),
  model: z.string(),
  params: z.object({ prompt: z.string() }).passthrough(),
  prechargeResult: z.record(z.unknown()).optional(),
  provider: z.string(),
  route: z.object({
    aspect: z.enum(['16:9', '9:16']),
    image: z.string().optional(),
    seconds: z.union([z.literal(4), z.literal(6), z.literal(8)]),
  }),
  webhookToken: z.string(),
});

export const videoRouter = router({
  createViaRouter: videoProcedure.input(createViaRouterInput).mutation(async ({ input, ctx }) => {
    const {
      asyncTaskId,
      generationBatchId,
      generationId,
      generationTopicId,
      model,
      params,
      prechargeResult,
      provider,
      route,
      webhookToken,
    } = input;
    const { videoDeadlineMs } = getMediaRouterConfig();
    const startedAt = Date.now();

    const task = await ctx.serverDB.query.asyncTasks.findFirst({
      where: eq(asyncTasks.id, asyncTaskId),
    });
    if (!task) return { success: false };
    const baseMeta = (task.metadata ?? {}) as Record<string, unknown>;

    await ctx.asyncTaskModel.update(asyncTaskId, {
      metadata: {
        ...baseMeta,
        routerDeadlineAt: new Date(startedAt + videoDeadlineMs).toISOString(),
        routerStartedAt: new Date(startedAt).toISOString(),
        servedBy: `${ROUTER_PROVIDER_ID}-attempt`,
      },
      status: AsyncTaskStatus.Processing,
    });

    const result = await generateViaRouter(
      () => submitRouterVideo(route as VideoRoute, params.prompt),
      videoDeadlineMs,
    );
    releaseVideoSlot();

    if (result.outcome === 'ok' && result.buffer && looksLikeMp4(result.buffer)) {
      recordRouterOutcome('video', 'ok');
      try {
        const videoService = new VideoGenerationService(ctx.serverDB, ctx.userId);
        const processed = await videoService.processVideoForGeneration({ buffer: result.buffer });
        const batch = await ctx.generationBatchModel.findById(generationBatchId);
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
        await ctx.generationModel.createAssetAndFile(
          generationId,
          asset,
          {
            fileHash: processed.fileHash,
            fileType: processed.mimeType,
            name: `${sanitizeFileName(batch?.prompt ?? params.prompt, generationId)}.mp4`,
            size: processed.fileSize,
            url: processed.videoKey,
          },
          FileSource.VideoGeneration,
        );
        const duration = Date.now() - new Date(task.createdAt).getTime();
        await ctx.asyncTaskModel.update(asyncTaskId, {
          duration,
          metadata: {
            ...baseMeta,
            actualSeconds: processed.duration,
            routerJobId: result.jobId,
            servedBy: ROUTER_PROVIDER_ID,
          },
          status: AsyncTaskStatus.Success,
        });

        if (ENABLE_BUSINESS_FEATURES) {
          const batchConfig = (batch?.config ?? {}) as RuntimeVideoGenParams;
          // Never charge more than requested: the hold was taken for
          // `route.seconds`; a longer clip from the pool is a gift, not a bill.
          const billedSeconds = Math.min(route.seconds, processed.duration || route.seconds);
          await chargeAfterGenerate({
            computePriceParams: { generateAudio: batchConfig.generateAudio },
            latency: duration,
            metadata: {
              asyncTaskId,
              generationBatchId,
              modelId: model,
              topicId: generationTopicId,
            },
            model,
            prechargeResult: prechargeResult as any,
            provider,
            referenceSeconds: referenceSecondsFor(
              (batchConfig ?? {}) as { referenceSeconds?: number; videoUrls?: unknown[] },
            ),
            resolution:
              typeof batchConfig.resolution === 'string' ? batchConfig.resolution : undefined,
            served: { provider: ROUTER_PROVIDER_ID, providerCostUsd: 0 },
            usage: { completionTokens: 0, durationSeconds: billedSeconds, totalTokens: 0 },
            userId: ctx.userId,
          });
        }
        log(
          'router video done task=%s job=%s in %dms',
          asyncTaskId,
          result.jobId,
          Date.now() - startedAt,
        );
        return { success: true, servedBy: ROUTER_PROVIDER_ID };
      } catch (error) {
        // The clip exists but we failed to store/charge it — treat as a
        // router failure so the user still gets a WaveSpeed result.
        console.error('[media-router] video post-processing failed, falling back:', error);
      }
    } else {
      recordRouterOutcome('video', result.outcome, result.retryAfterMs);
      console.warn(
        `[media-router] video fallback task=${asyncTaskId} reason=${result.outcome} ${result.error ?? ''}`,
      );
    }

    // ---- Fallback: the regular WaveSpeed submission (same task, same webhook token) ----
    try {
      const modelRuntime = await initModelRuntimeFromDB(ctx.serverDB, ctx.userId, provider);
      const callbackBaseUrl = process.env.WEBHOOK_PROXY_URL || appEnv.APP_URL;
      const callbackUrl = `${callbackBaseUrl}/api/webhooks/video/${provider}?token=${webhookToken}`;
      const response = await modelRuntime.createVideo({
        callbackUrl,
        model,
        params: params as unknown as RuntimeVideoGenParams,
      });
      await ctx.asyncTaskModel.update(asyncTaskId, {
        inferenceId: response?.inferenceId,
        metadata: {
          ...baseMeta,
          routerFallbackReason: result.error ?? result.outcome,
          servedBy: 'wavespeed',
        },
        status: AsyncTaskStatus.Processing,
      });
      return { success: true, servedBy: 'wavespeed' };
    } catch (e) {
      console.error('[media-router] WaveSpeed fallback submit failed:', e);
      await ctx.asyncTaskModel.update(asyncTaskId, {
        error: new AsyncTaskError(
          AsyncTaskErrorType.TaskTriggerError,
          'Failed to submit video task: ' + (e instanceof Error ? e.message : 'Unknown error'),
        ),
        status: AsyncTaskStatus.Error,
      });
      if (prechargeResult) {
        try {
          await chargeAfterGenerate({
            isError: true,
            metadata: {
              asyncTaskId,
              generationBatchId,
              modelId: model,
              topicId: generationTopicId,
            },
            model,
            prechargeResult: prechargeResult as any,
            provider,
            userId: ctx.userId,
          });
        } catch (chargeError) {
          console.error('[media-router] refund after failed fallback:', chargeError);
        }
      }
      return { success: false };
    }
  }),
});
