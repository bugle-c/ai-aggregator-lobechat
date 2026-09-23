/**
 * Polling fallback for video generation tasks that are stuck in
 * pending/processing because the provider webhook never arrived.
 *
 * Runs from a host-level cron every 5 minutes:
 *   * /5 * * * * curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *      https://ask.gptweb.ru/api/cron/poll-stuck-video-jobs
 *
 * Strategy: query upstream provider for the prediction status, then forward
 * the result to our own webhook endpoint so the existing route handles
 * persistence, asset upload, charging and refund logic uniformly.
 *
 * Window: tasks aged 5 min < age < 1 h. Younger than 5 min — we trust the
 * webhook; older than 1 h — `AsyncTaskModel.checkTimeoutTasks` already marks
 * them errored.
 *
 * Idempotency: the downstream webhook route checks AsyncTask.status === Success
 * | Error and short-circuits, so re-firing for an already-handled task is safe.
 */
import { AsyncTaskStatus } from '@lobechat/types';
import { and, eq, gt, inArray, lt } from 'drizzle-orm';

import { looksLikeMp4, pollRouterJob } from '@/business/server/media-router/client';
import {
  failRouterVideo,
  finalizeRouterVideoSuccess,
  ROUTER_VIDEO_FAILED_MESSAGE,
} from '@/business/server/media-router/finalizeVideo';
import { asyncTasks, generationBatches, generations } from '@/database/schemas';
import { getServerDB } from '@/database/server';

interface WaveSpeedResultResponse {
  data?: {
    error?: string | null;
    id?: string;
    status?: 'created' | 'processing' | 'completed' | 'failed';
  };
}

const POLL_WINDOW_MIN_AGE_MS = 5 * 60 * 1000; // 5 min
const POLL_WINDOW_MAX_AGE_MS = 60 * 60 * 1000; // 1 h

interface PollResult {
  action:
    | 'replayed-webhook'
    | 'router-attempt'
    | 'router-finished'
    | 'router-failed'
    | 'still-running'
    | 'unsupported-provider'
    | 'error';
  error?: string;
  status?: string;
  taskId: string;
  webhookStatus?: number;
}

export async function POST(req: Request) {
  const auth = req.headers.get('authorization');
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const db = await getServerDB();

  const now = Date.now();
  const minAge = new Date(now - POLL_WINDOW_MAX_AGE_MS); // older than this → ignore (timeout)
  const maxAge = new Date(now - POLL_WINDOW_MIN_AGE_MS); // newer than this → too soon

  // Join asyncTasks → generations → generationBatches to recover the provider
  // string (which is not stored on the task itself; the webhook URL carries
  // it via [provider] segment, but cron has no URL — we derive from the
  // batch row that owns this task).
  const stuck = await db
    .select({
      createdAt: asyncTasks.createdAt,
      generationBatchId: generations.generationBatchId,
      generationId: generations.id,
      generationTopicId: generationBatches.generationTopicId,
      id: asyncTasks.id,
      inferenceId: asyncTasks.inferenceId,
      metadata: asyncTasks.metadata,
      model: generationBatches.model,
      provider: generationBatches.provider,
      status: asyncTasks.status,
      userId: asyncTasks.userId,
    })
    .from(asyncTasks)
    .innerJoin(generations, eq(generations.asyncTaskId, asyncTasks.id))
    .innerJoin(generationBatches, eq(generationBatches.id, generations.generationBatchId))
    .where(
      and(
        inArray(asyncTasks.status, [AsyncTaskStatus.Pending, AsyncTaskStatus.Processing]),
        lt(asyncTasks.createdAt, maxAge),
        gt(asyncTasks.createdAt, minAge),
      ),
    )
    .limit(50); // protective cap — single cron tick shouldn't fan out beyond this

  const results: PollResult[] = [];

  for (const task of stuck) {
    const meta = (task.metadata ?? {}) as Record<string, unknown>;
    const provider = task.provider;
    const webhookToken = typeof meta.webhookToken === 'string' ? meta.webhookToken : undefined;

    // Router-first attempt whose async procedure is gone (container recreated
    // mid-poll — deploys do that): poll the router job ourselves and finish
    // or fail the task; never leave it for the 1 h timeout.
    if (meta.servedBy === 'llm-router-attempt') {
      const ref = {
        asyncTaskId: task.id,
        generationBatchId: task.generationBatchId,
        generationId: task.generationId,
        generationTopicId: task.generationTopicId ?? undefined,
        model: task.model,
        prechargeResult: meta.precharge as Record<string, unknown> | undefined,
        provider: task.provider,
        userId: task.userId,
      };
      const baseMeta = meta;
      const jobId = typeof meta.routerJobId === 'string' ? meta.routerJobId : undefined;
      const deadlineAt =
        typeof meta.routerDeadlineAt === 'string'
          ? Date.parse(meta.routerDeadlineAt)
          : task.createdAt.getTime() + 9 * 60 * 1000;
      // The async procedure polls in-process until routerDeadlineAt; while it
      // may still be alive we must not touch the task (2026-09-23: cron and
      // procedure finished the same task 3 s apart → double refund).
      if (jobId && now < deadlineAt + 60_000) {
        results.push({ action: 'router-attempt', status: 'running', taskId: task.id });
        continue;
      }
      if (!jobId) {
        await failRouterVideo(db, ref, {
          baseMeta,
          message: ROUTER_VIDEO_FAILED_MESSAGE,
          reason: 'no routerJobId (lost before submit)',
        });
        results.push({ action: 'router-failed', error: 'no routerJobId', taskId: task.id });
        continue;
      }
      const r = await pollRouterJob(jobId, 12_000);
      if (r.outcome === 'ok' && r.buffer && looksLikeMp4(r.buffer)) {
        const requested =
          typeof (meta.route as { seconds?: number } | undefined)?.seconds === 'number'
            ? (meta.route as { seconds: number }).seconds
            : 8;
        await finalizeRouterVideoSuccess(db, ref, {
          baseMeta,
          buffer: r.buffer,
          jobId,
          requestedSeconds: requested,
          taskCreatedAt: task.createdAt,
        });
        results.push({ action: 'router-finished', taskId: task.id });
      } else if (r.outcome === 'timeout' && now < deadlineAt + 3 * 60 * 1000) {
        results.push({ action: 'router-attempt', status: 'running', taskId: task.id });
      } else {
        await failRouterVideo(db, ref, {
          baseMeta,
          message: ROUTER_VIDEO_FAILED_MESSAGE,
          reason: r.error ?? r.outcome,
        });
        results.push({ action: 'router-failed', error: r.error ?? r.outcome, taskId: task.id });
      }
      continue;
    }

    if (!task.inferenceId || !provider) {
      results.push({ action: 'error', error: 'missing inferenceId or provider', taskId: task.id });
      continue;
    }

    if (provider !== 'wavespeed') {
      // Other async-video providers (Volcengine, etc.) have their own polling
      // semantics. Add per-provider branches here as needed.
      results.push({ action: 'unsupported-provider', taskId: task.id });
      continue;
    }

    try {
      const apiKey = process.env.WAVESPEED_API_KEY;
      if (!apiKey) {
        results.push({ action: 'error', error: 'WAVESPEED_API_KEY not set', taskId: task.id });
        continue;
      }

      // 1) Fetch upstream prediction state.
      const upstream = await fetch(
        `https://api.wavespeed.ai/api/v3/predictions/${task.inferenceId}/result`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );
      if (!upstream.ok) {
        results.push({
          action: 'error',
          error: `wavespeed result HTTP ${upstream.status}`,
          taskId: task.id,
        });
        continue;
      }

      const payload = (await upstream.json()) as WaveSpeedResultResponse;
      const status = payload.data?.status;

      if (status !== 'completed' && status !== 'failed') {
        results.push({ action: 'still-running', status, taskId: task.id });
        continue;
      }

      // 2) Replay through our own webhook route so all the persistence,
      // download, S3 upload, AsyncTask transition and chargeAfterGenerate
      // logic stays in one place. Token is required by the route's auth check.
      const baseUrl =
        process.env.APP_URL ||
        process.env.WEBSITE_URL ||
        process.env.NEXT_PUBLIC_SERVICE_MODE_URL ||
        'https://ask.gptweb.ru';
      const webhookUrl = webhookToken
        ? `${baseUrl}/api/webhooks/video/${provider}?token=${encodeURIComponent(webhookToken)}`
        : `${baseUrl}/api/webhooks/video/${provider}`;

      const webhookRes = await fetch(webhookUrl, {
        body: JSON.stringify(payload.data),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });

      results.push({
        action: 'replayed-webhook',
        status,
        taskId: task.id,
        webhookStatus: webhookRes.status,
      });
    } catch (err) {
      results.push({ action: 'error', error: (err as Error).message, taskId: task.id });
    }
  }

  return Response.json({ checked: stuck.length, results, scannedAt: new Date().toISOString() });
}
