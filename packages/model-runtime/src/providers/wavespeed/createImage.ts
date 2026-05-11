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
/**
 * Async submit: POST to wavespeed and return the inference id + poll URL.
 * Caller is responsible for persisting these and polling later
 * (typically via a cron). Use this when the image router should return
 * to the browser immediately instead of blocking until the asset is
 * ready.
 */
export async function submitWaveSpeedImage(
  payload: CreateImagePayload,
  options: CreateImageOptions,
): Promise<{ inferenceId: string; pollUrl: string }> {
  const { model, params } = payload;
  const baseURL = options.baseURL || 'https://api.wavespeed.ai/api/v3';
  const body = buildBody(params);

  const res = await fetch(`${baseURL}/${model}`, {
    body: JSON.stringify(body),
    headers: {
      'Authorization': `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`WaveSpeed image submit error: ${res.status} ${errorText}`);
  }

  const data = (await res.json()) as WaveSpeedCreateResponse;
  if (!data?.data?.id) {
    throw new Error('Invalid WaveSpeed response: missing data.id');
  }

  return {
    inferenceId: data.data.id,
    pollUrl: data.data.urls?.get ?? `${baseURL}/predictions/${data.data.id}/result`,
  };
}

/**
 * Async check: GET the wavespeed result for an inference. Returns the
 * raw status plus the image URL when completed (or an error string
 * when failed). Used by the polling cron to finalize tasks.
 */
export async function checkWaveSpeedImage(
  pollUrl: string,
  options: { apiKey: string },
): Promise<{ status: string; imageUrl?: string; error?: string }> {
  const res = await fetch(pollUrl, {
    headers: { Authorization: `Bearer ${options.apiKey}` },
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`WaveSpeed poll error: ${res.status} ${errorText}`);
  }
  const data = (await res.json()) as { data: WaveSpeedWebhookBody };
  return {
    error: data.data?.error ?? undefined,
    imageUrl: data.data?.outputs?.[0],
    status: data.data?.status ?? 'unknown',
  };
}

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
