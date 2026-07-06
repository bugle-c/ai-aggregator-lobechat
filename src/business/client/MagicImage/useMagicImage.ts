'use client';

import type { ImageGenerationAsset } from '@lobechat/types';
import { useCallback, useEffect, useRef, useState } from 'react';

import { reachGoal } from '@/business/client/analytics/ym';
import { lambdaClient } from '@/libs/trpc/client';
import { generationService } from '@/services/generation';
import { AsyncTaskStatus } from '@/types/asyncTask';

const MAGIC_IMAGE_MODEL = 'google/nano-banana-2/text-to-image';
const MAGIC_IMAGE_PROVIDER = 'lobehub';

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120_000;

/**
 * One-shot flag: once the earned free image succeeded, the CTA never
 * comes back (fresh mounts read this before rendering the idle button).
 */
export const MAGIC_IMAGE_DONE_KEY = 'webgpt_magic_image_done';

export const isMagicImageDone = () => {
  try {
    return localStorage.getItem(MAGIC_IMAGE_DONE_KEY) === '1';
  } catch {
    return false;
  }
};

const markMagicImageDone = () => {
  try {
    localStorage.setItem(MAGIC_IMAGE_DONE_KEY, '1');
  } catch {
    /* noop */
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type MagicImageStatus = 'error' | 'generating' | 'hidden' | 'idle' | 'success';

/**
 * Drives the "earned free image" flow: claim the magic bonus (server-gated),
 * create a dedicated generation topic, fire one image generation and poll it
 * to completion. Billing rides the normal image pipeline against the bonus
 * credits; failed generations are auto-refunded server-side.
 */
export const useMagicImage = () => {
  const [status, setStatus] = useState<MagicImageStatus>('idle');
  const [imageUrl, setImageUrl] = useState<string>();

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const safeSetStatus = useCallback((next: MagicImageStatus) => {
    if (mountedRef.current) setStatus(next);
  }, []);

  const generate = useCallback(
    async (prompt: string) => {
      if (status === 'generating') return;
      safeSetStatus('generating');

      try {
        // 1. Server-authoritative gate + one-shot idempotent bonus grant.
        const claim = await lambdaClient.userOnboarding.claimMagicBonus.mutate();
        if (!claim.granted && !claim.alreadyClaimed) {
          // reason: 'not_yet' — the server disagrees with the client gate; hide quietly.
          safeSetStatus('hidden');
          return;
        }

        // 2. Dedicated generation topic for the magic image.
        const topicId = await lambdaClient.generationTopic.createTopic.mutate({ type: 'image' });

        // 3. Fire the generation. GOTCHA: generations in this response come
        //    back with asyncTaskId=null — the real id appears only after the
        //    async task is scheduled, so re-read batches below.
        await lambdaClient.image.createImage.mutate({
          generationTopicId: topicId,
          imageNum: 1,
          model: MAGIC_IMAGE_MODEL,
          params: { prompt },
          provider: MAGIC_IMAGE_PROVIDER,
        });

        // 4. Re-read batches to obtain the real generationId + asyncTaskId.
        let generationId: string | undefined;
        let asyncTaskId: string | null | undefined;
        for (let attempt = 0; attempt < 3; attempt++) {
          const batches = await lambdaClient.generationBatch.getGenerationBatches.query({
            topicId,
          });
          const generation = batches.at(-1)?.generations?.[0];
          generationId = generation?.id;
          asyncTaskId = generation?.asyncTaskId;
          if (generationId && asyncTaskId) break;
          await sleep(2000);
        }

        if (!generationId || !asyncTaskId) throw new Error('Magic image: async task never appeared');

        // 5. Poll the async task every 3s, up to 120s.
        const deadline = Date.now() + POLL_TIMEOUT_MS;
        while (Date.now() < deadline) {
          const result = await generationService.getGenerationStatus(generationId, asyncTaskId);

          if (result.status === AsyncTaskStatus.Success) {
            const url = (result.generation?.asset as ImageGenerationAsset | null)?.url;
            if (!url) throw new Error('Magic image: success without asset url');
            if (mountedRef.current) setImageUrl(url);
            markMagicImageDone();
            reachGoal('first_image');
            safeSetStatus('success');
            return;
          }

          if (result.status === AsyncTaskStatus.Error) {
            throw new Error('Magic image: generation failed');
          }

          await sleep(POLL_INTERVAL_MS);
        }

        throw new Error('Magic image: polling timed out');
      } catch (error) {
        console.error('[MagicImage]', error);
        safeSetStatus('error');
      }
    },
    [safeSetStatus, status],
  );

  return { generate, imageUrl, status };
};
