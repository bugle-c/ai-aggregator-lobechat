import createDebug from 'debug';

import type { CreateImageOptions } from '../../core/openaiCompatibleFactory';
import type { CreateImagePayload, CreateImageResponse } from '../../types/image';
import type { WaveSpeedCreateResponse, WaveSpeedWebhookBody } from './type';

const log = createDebug('lobe-image:wavespeed');

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 120_000; // 2 minutes — images usually complete in 2-30s

/**
 * WaveSpeed AI image generation.
 *
 * WaveSpeed is async-first: POST creates a prediction, we poll the result URL
 * until status is `completed` or `failed`. For the `createImage` entrypoint
 * we always block until completion, since LobeChat treats image generation
 * as synchronous. Per-model latency varies — fastest (Z-Image Turbo, FLUX
 * Schnell) return in ~1s, slower models (Nano Banana Pro, Seedream) in 5-30s.
 *
 * @see https://wavespeed.ai/docs/submit-task
 * @see https://wavespeed.ai/docs/get-result
 */
export async function createWaveSpeedImage(
  payload: CreateImagePayload,
  options: CreateImageOptions,
): Promise<CreateImageResponse> {
  const { model, params } = payload;
  const baseURL = options.baseURL || 'https://api.wavespeed.ai/api/v3';

  log('Creating image - model: %s, params: %O', model, params);

  const body = buildBody(params);

  const createRes = await fetch(`${baseURL}/${model}`, {
    body: JSON.stringify(body),
    headers: {
      'Authorization': `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (!createRes.ok) {
    const errorText = await createRes.text();
    log('WaveSpeed image create error: %s %s', createRes.status, errorText);
    throw new Error(`WaveSpeed image API error: ${createRes.status} ${errorText}`);
  }

  const createData = (await createRes.json()) as WaveSpeedCreateResponse;
  if (!createData?.data?.id) {
    throw new Error('Invalid WaveSpeed response: missing data.id');
  }

  const pollUrl =
    createData.data.urls?.get ?? `${baseURL}/predictions/${createData.data.id}/result`;

  // Poll until completed or failed
  const started = Date.now();
  while (Date.now() - started < POLL_TIMEOUT_MS) {
    const pollRes = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${options.apiKey}` },
    });

    if (!pollRes.ok) {
      const errorText = await pollRes.text();
      log('WaveSpeed poll error: %s %s', pollRes.status, errorText);
      throw new Error(`WaveSpeed poll error: ${pollRes.status} ${errorText}`);
    }

    const pollData = (await pollRes.json()) as { data: WaveSpeedWebhookBody };
    const status = pollData.data?.status;

    if (status === 'completed') {
      const imageUrl = pollData.data?.outputs?.[0];
      if (!imageUrl) {
        throw new Error('WaveSpeed image completed but outputs[0] missing');
      }
      log('Image generated: %s', imageUrl);
      return { imageUrl };
    }

    if (status === 'failed') {
      const err = pollData.data?.error ?? 'unknown';
      throw new Error(`WaveSpeed image generation failed: ${err}`);
    }

    // created / processing — wait
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(
    `WaveSpeed image generation timed out after ${POLL_TIMEOUT_MS}ms (prediction ${createData.data.id})`,
  );
}

/**
 * Map LobeChat RuntimeImageGenParams → WaveSpeed body.
 *
 * WaveSpeed body shape varies per model but these fields cover the common
 * cases for FLUX / Seedream / Nano Banana / Ideogram / Recraft / Qwen-Image
 * / Imagen / GPT Image / Z-Image.
 */
function buildBody(params: CreateImagePayload['params']): Record<string, unknown> {
  const { prompt, imageUrls, imageUrl, width, height, size, seed, cfg, steps, negativePrompt } =
    params as Record<string, unknown> & CreateImagePayload['params'];

  const body: Record<string, unknown> = { prompt };

  if (imageUrls) body.images = imageUrls;
  else if (imageUrl) body.image = imageUrl;

  if (size) {
    body.size = size;
  } else if (width !== undefined && height !== undefined) {
    body.size = `${width}*${height}`;
  }

  if (seed !== undefined && seed !== null) body.seed = seed;
  if (cfg !== undefined) body.guidance_scale = cfg;
  if (steps !== undefined) body.num_inference_steps = steps;
  if (negativePrompt !== undefined) body.negative_prompt = negativePrompt;

  return body;
}
