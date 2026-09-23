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
import { AsyncTaskError, AsyncTaskErrorType, AsyncTaskStatus } from '@lobechat/types';
import debug from 'debug';
import { eq } from 'drizzle-orm';
import { type RuntimeVideoGenParams } from 'model-bank';
import { z } from 'zod';

import { recordRouterOutcome } from '@/business/server/media-router/breaker';
import {
  releaseVideoSlot,
  tryReserveTrialFallbackSlot,
} from '@/business/server/media-router/budget';
import {
  looksLikeMp4,
  pollRouterJob,
  type RouterResult,
  submitRouterVideo,
} from '@/business/server/media-router/client';
import { getMediaRouterConfig, ROUTER_PROVIDER_ID } from '@/business/server/media-router/config';
import { type VideoRoute } from '@/business/server/media-router/eligibility';
import {
  failRouterVideo,
  finalizeRouterVideoSuccess,
} from '@/business/server/media-router/finalizeVideo';
import { FREE_VIDEO_QUEUE_MESSAGE } from '@/business/server/media-router/newcomer';
import { chargeAfterGenerate } from '@/business/server/video-generation/chargeAfterGenerate';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { asyncTasks } from '@/database/schemas';
import { appEnv } from '@/envs/app';
import { asyncAuthedProcedure, asyncRouter as router } from '@/libs/trpc/async';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

const log = debug('lobe-video:async:router');

const videoProcedure = asyncAuthedProcedure.use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      asyncTaskModel: new AsyncTaskModel(ctx.serverDB, ctx.userId),
    },
  });
});

const createViaRouterInput = z.object({
  asyncTaskId: z.string(),
  /** Free-plan «одно видео» — never fall back to WaveSpeed beyond the daily trial budget. */
  freeTrial: z.boolean().optional(),
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
      freeTrial,
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
    const baseMeta = {
      ...((task.metadata ?? {}) as Record<string, unknown>),
      route,
      routerDeadlineAt: new Date(startedAt + videoDeadlineMs).toISOString(),
      routerStartedAt: new Date(startedAt).toISOString(),
    };

    await ctx.asyncTaskModel.update(asyncTaskId, {
      metadata: {
        ...baseMeta,
        route,
        routerDeadlineAt: new Date(startedAt + videoDeadlineMs).toISOString(),
        routerStartedAt: new Date(startedAt).toISOString(),
        servedBy: `${ROUTER_PROVIDER_ID}-attempt`,
      },
      status: AsyncTaskStatus.Processing,
    });

    const ref = {
      asyncTaskId,
      generationBatchId,
      generationId,
      generationTopicId,
      model,
      prechargeResult: prechargeResult as Record<string, unknown> | undefined,
      provider,
      userId: ctx.userId,
    };

    // Submit, remember the router job id (so the poll cron can take over if
    // this container is recreated mid-poll), then poll until the deadline.
    const submitted = await submitRouterVideo(route as VideoRoute, params.prompt);
    let result: RouterResult;
    let routerJobId: string | undefined;
    if (!('outcome' in submitted)) {
      routerJobId = submitted.jobId;
      await ctx.asyncTaskModel.update(asyncTaskId, {
        metadata: {
          ...baseMeta,
          routerJobId: submitted.jobId,
          servedBy: `${ROUTER_PROVIDER_ID}-attempt`,
        },
      });
      result = await pollRouterJob(routerJobId, videoDeadlineMs);
    } else {
      result = submitted;
    }
    releaseVideoSlot();

    // Someone else (the poll cron after a restart) may have settled the task
    // while we were polling — never finish it twice.
    const fresh = await ctx.serverDB.query.asyncTasks.findFirst({
      where: eq(asyncTasks.id, asyncTaskId),
    });
    if (fresh?.status !== AsyncTaskStatus.Processing) {
      console.warn(`[media-router] task ${asyncTaskId} already ${fresh?.status}; skipping`);
      return { success: false, servedBy: 'none' };
    }

    if (result.outcome === 'ok' && result.buffer && looksLikeMp4(result.buffer)) {
      recordRouterOutcome('video', 'ok');
      try {
        await finalizeRouterVideoSuccess(ctx.serverDB, ref, {
          baseMeta,
          buffer: result.buffer,
          jobId: result.jobId ?? routerJobId,
          requestedSeconds: route.seconds,
          taskCreatedAt: new Date(task.createdAt),
        });
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

    // ---- Free trial: only a bounded number of WaveSpeed fallbacks per day ----
    if (freeTrial && !tryReserveTrialFallbackSlot()) {
      console.warn(
        `[media-router] free-trial video ${asyncTaskId}: pool failed, fallback budget spent`,
      );
      await failRouterVideo(ctx.serverDB, ref, {
        baseMeta,
        message: FREE_VIDEO_QUEUE_MESSAGE,
        reason: result.error ?? result.outcome,
      });
      return { success: false, servedBy: 'none' };
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
