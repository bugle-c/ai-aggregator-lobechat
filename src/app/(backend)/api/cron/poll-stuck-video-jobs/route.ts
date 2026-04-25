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
  action: 'replayed-webhook' | 'still-running' | 'unsupported-provider' | 'error';
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
      id: asyncTasks.id,
      inferenceId: asyncTasks.inferenceId,
      metadata: asyncTasks.metadata,
      provider: generationBatches.provider,
      status: asyncTasks.status,
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
