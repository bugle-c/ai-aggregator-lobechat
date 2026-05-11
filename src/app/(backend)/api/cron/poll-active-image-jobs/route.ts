/**
 * Poll-active-image-jobs.
 *
 * Replaces the sync-blocking tRPC mutation behaviour for WaveSpeed
 * image generation. The router now submits the request to WaveSpeed,
 * persists `inference_id` + pollUrl in async_tasks, and returns to the
 * browser within ~1 sec. This cron then:
 *
 *   - Polls each pending/processing task's WaveSpeed URL.
 *   - On `completed` → downloads the asset, uploads to S3, writes the
 *     generation row + file, charges credits (settles the hold), marks
 *     the async task Success.
 *   - On `failed` → marks Error, refunds the hold via
 *     chargeAfterGenerate({isError: true}).
 *   - On still-running → noop, picked up on next tick.
 *
 * Runs every ~15 sec from host cron. Image jobs typically finish in
 * 2-30 sec, so 15 sec polling gives ≤30 sec end-to-end perceived
 * latency. Bounded to 50 tasks per run to stay under WaveSpeed rate
 * limits.
 */
import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { checkWaveSpeedImage } from '@lobechat/model-runtime';
import { AsyncTaskStatus } from '@lobechat/types';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';

import { chargeAfterGenerate } from '@/business/server/image-generation/chargeAfterGenerate';
import { GenerationModel } from '@/database/models/generation';
import { asyncTasks, generationBatches, generations } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { GenerationService } from '@/server/services/generation';
import { sanitizeFileName } from '@/utils/sanitizeFileName';

export const dynamic = 'force-dynamic';

interface StuckRow {
  generationBatchId: string;
  generationId: string;
  generationTopicId: string;
  inferenceId: string | null;
  metadata: Record<string, unknown> | null;
  model: string;
  prompt: string;
  provider: string;
  taskId: string;
  userId: string;
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  const apiKey = process.env.WAVESPEED_API_KEY;
  if (!apiKey) {
    return Response.json({ ok: false, reason: 'WAVESPEED_API_KEY missing' }, { status: 500 });
  }

  const db = await getServerDB();

  const rows = (await db
    .select({
      taskId: asyncTasks.id,
      userId: asyncTasks.userId,
      inferenceId: asyncTasks.inferenceId,
      metadata: asyncTasks.metadata,
      generationId: generations.id,
      generationBatchId: generations.generationBatchId,
      generationTopicId: generationBatches.generationTopicId,
      provider: generationBatches.provider,
      model: generationBatches.model,
      prompt: generationBatches.prompt,
    })
    .from(asyncTasks)
    .innerJoin(generations, eq(generations.asyncTaskId, asyncTasks.id))
    .innerJoin(generationBatches, eq(generationBatches.id, generations.generationBatchId))
    .where(
      and(
        eq(asyncTasks.type, 'image_generation'),
        inArray(asyncTasks.status, [AsyncTaskStatus.Pending, AsyncTaskStatus.Processing]),
        isNotNull(asyncTasks.inferenceId),
      ),
    )
    .limit(50)) as unknown as StuckRow[];

  let completed = 0;
  let failed = 0;
  let stillRunning = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      const pollUrl =
        (row.metadata as { pollUrl?: string } | null)?.pollUrl ??
        `https://api.wavespeed.ai/api/v3/predictions/${row.inferenceId}/result`;

      const r = await checkWaveSpeedImage(pollUrl, { apiKey });

      if (r.status === 'completed' && r.imageUrl) {
        const generationService = new GenerationService(db, row.userId);
        const generationModel = new GenerationModel(db, row.userId);

        const { image, thumbnailImage } = await generationService.transformImageForGeneration(
          r.imageUrl,
        );
        const { imageUrl: uploadedImageUrl, thumbnailImageUrl } =
          await generationService.uploadImageForGeneration(image, thumbnailImage);

        await generationModel.createAssetAndFile(
          row.generationId,
          {
            height: image.height,
            originalUrl: r.imageUrl,
            thumbnailUrl: thumbnailImageUrl,
            type: 'image',
            url: uploadedImageUrl,
            width: image.width,
          },
          {
            fileHash: image.hash,
            fileType: image.mime,
            metadata: {
              generationId: row.generationId,
              height: image.height,
              path: uploadedImageUrl,
              width: image.width,
            },
            name: `${sanitizeFileName(row.prompt, row.generationId)}.${image.extension}`,
            size: image.size,
            url: uploadedImageUrl,
          },
        );

        await db
          .update(asyncTasks)
          .set({ status: AsyncTaskStatus.Success, updatedAt: new Date() })
          .where(eq(asyncTasks.id, row.taskId));

        if (ENABLE_BUSINESS_FEATURES) {
          await chargeAfterGenerate({
            metadata: {
              asyncTaskId: row.taskId,
              generationBatchId: row.generationBatchId,
              modelId: row.model,
              topicId: row.generationTopicId,
            },
            provider: row.provider,
            userId: row.userId,
          });
        }
        completed++;
      } else if (r.status === 'failed') {
        await db
          .update(asyncTasks)
          .set({
            status: AsyncTaskStatus.Error,
            error: { name: 'WaveSpeedError', body: r.error || 'failed' },
            updatedAt: new Date(),
          })
          .where(eq(asyncTasks.id, row.taskId));

        if (ENABLE_BUSINESS_FEATURES) {
          await chargeAfterGenerate({
            isError: true,
            metadata: {
              asyncTaskId: row.taskId,
              generationBatchId: row.generationBatchId,
              modelId: row.model,
              topicId: row.generationTopicId,
            },
            provider: row.provider,
            userId: row.userId,
          });
        }
        failed++;
      } else {
        stillRunning++;
      }
    } catch (err) {
      errors++;
      console.error('[poll-active-image-jobs] task', row.taskId, err);
    }
  }

  return Response.json({
    ok: true,
    checked: rows.length,
    completed,
    failed,
    stillRunning,
    errors,
  });
}
