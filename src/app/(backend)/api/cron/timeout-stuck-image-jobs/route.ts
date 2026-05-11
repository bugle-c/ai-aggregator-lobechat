/**
 * Time-out image generation tasks that are pinned at pending/processing.
 *
 * Image router is a synchronous tRPC mutation — the browser holds the
 * connection while the server calls Wavespeed, downloads the asset and
 * marks the task Success. If the container restarts mid-flight (deploy)
 * or the upstream call hangs past the request timeout, the task is left
 * in `processing` forever:
 *   - Wavespeed actually rendered the image (and we paid them for it),
 *     but we never got the result into our DB.
 *   - UI shows "Мои генерации" with a never-resolving loading card.
 *   - The pre-charge hold remains until release-stale-holds (24 h).
 *
 * Image flow does NOT persist Wavespeed's inference_id, so we cannot
 * poll for the result — recovery is impossible without code changes
 * elsewhere. Best we can do is bound the wait: after STALE_THRESHOLD
 * mark the task Error and refund the user via chargeAfterGenerate.
 * They re-submit; their credits are intact.
 *
 * Triggered by host cron every 5 min with Bearer CRON_SECRET.
 */
import { AsyncTaskStatus } from '@lobechat/types';
import { and, eq, inArray, lt } from 'drizzle-orm';

import { chargeAfterGenerate } from '@/business/server/image-generation/chargeAfterGenerate';
import { asyncTasks, generationBatches, generations } from '@/database/schemas';
import { getServerDB } from '@/database/server';

const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 min

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const db = await getServerDB();
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);

  const stuck = await db
    .select({
      taskId: asyncTasks.id,
      userId: generationBatches.userId,
      provider: generationBatches.provider,
      model: generationBatches.model,
      generationBatchId: generations.generationBatchId,
      topicId: generationBatches.generationTopicId,
    })
    .from(asyncTasks)
    .innerJoin(generations, eq(generations.asyncTaskId, asyncTasks.id))
    .innerJoin(generationBatches, eq(generationBatches.id, generations.generationBatchId))
    .where(
      and(
        eq(asyncTasks.type, 'image_generation'),
        inArray(asyncTasks.status, [AsyncTaskStatus.Pending, AsyncTaskStatus.Processing]),
        lt(asyncTasks.createdAt, cutoff),
      ),
    )
    .limit(50);

  let timedOut = 0;
  let refundErrors = 0;

  for (const row of stuck) {
    try {
      await db
        .update(asyncTasks)
        .set({
          status: AsyncTaskStatus.Error,
          error: { name: 'TimeoutError', body: 'Stuck > 10 min — auto-failed by cron' },
        })
        .where(eq(asyncTasks.id, row.taskId));

      // Refund the hold. chargeAfterGenerate's findOldestActiveHold
      // heuristic will pick a hold for this user with reason='image-gen'.
      await chargeAfterGenerate({
        isError: true,
        metadata: {
          asyncTaskId: row.taskId,
          generationBatchId: row.generationBatchId,
          modelId: row.model,
          topicId: row.topicId ?? undefined,
        },
        provider: row.provider,
        userId: row.userId,
      });

      timedOut++;
    } catch (err) {
      refundErrors++;
      console.error('[timeout-stuck-image] error for', row.taskId, err);
    }
  }

  return Response.json({ ok: true, timedOut, refundErrors, checked: stuck.length });
}
