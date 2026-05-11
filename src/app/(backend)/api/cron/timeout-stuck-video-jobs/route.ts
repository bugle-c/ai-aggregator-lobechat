/**
 * Time-out video generation tasks that have been stuck past the
 * poll-stuck-video-jobs window (1 hour). At that point the
 * provider has effectively given up — we should too, so the UI stops
 * showing a permanent loading card and the user gets their credits
 * back.
 *
 * Mirrors timeout-stuck-image-jobs but for `video_generation` async
 * tasks. Runs every 5 min from host cron.
 */
import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { AsyncTaskStatus } from '@lobechat/types';
import { and, eq, inArray, lt } from 'drizzle-orm';

import { chargeAfterGenerate } from '@/business/server/video-generation/chargeAfterGenerate';
import { asyncTasks, generationBatches, generations } from '@/database/schemas';
import { getServerDB } from '@/database/server';

const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

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
        eq(asyncTasks.type, 'video_generation'),
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
          error: { name: 'TimeoutError', body: 'Stuck > 1 hour — auto-failed by cron' },
        })
        .where(eq(asyncTasks.id, row.taskId));

      if (ENABLE_BUSINESS_FEATURES) {
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
      }

      timedOut++;
    } catch (err) {
      refundErrors++;
      console.error('[timeout-stuck-video] error for', row.taskId, err);
    }
  }

  return Response.json({ ok: true, timedOut, refundErrors, checked: stuck.length });
}
