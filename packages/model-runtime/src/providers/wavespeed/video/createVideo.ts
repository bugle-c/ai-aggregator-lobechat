import createDebug from 'debug';

import type { CreateVideoOptions } from '../../../core/openaiCompatibleFactory';
import type { CreateVideoPayload, CreateVideoResponse } from '../../../types/video';
import type { WaveSpeedCreateResponse } from '../type';

const log = createDebug('lobe-video:wavespeed');

/**
 * WaveSpeed AI video generation.
 *
 * Async flow: POST creates a prediction, WaveSpeed calls `callbackUrl` when
 * the job completes. The webhook URL (with per-task `?token=`) is appended
 * via the `?webhook=` query parameter, per WaveSpeed docs.
 *
 * @see https://wavespeed.ai/docs/submit-task
 * @see https://wavespeed.ai/docs/how-to-use-webhooks
 */
export async function createWaveSpeedVideo(
  payload: CreateVideoPayload,
  options: CreateVideoOptions,
): Promise<CreateVideoResponse> {
  const { model, params, callbackUrl } = payload;
  const baseURL = options.baseURL || 'https://api.wavespeed.ai/api/v3';

  log('Creating video - model: %s, params: %O', model, params);

  const body = buildBody(params);

  const url = callbackUrl
    ? `${baseURL}/${model}?webhook=${encodeURIComponent(callbackUrl)}`
    : `${baseURL}/${model}`;

  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: {
      'Authorization': `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (!response.ok) {
    const errorText = await response.text();
    log('WaveSpeed video API error: %s %s', response.status, errorText);
    throw new Error(`WaveSpeed video API error: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as WaveSpeedCreateResponse;

  log('WaveSpeed video API response: %O', data);

  if (!data?.data?.id) {
    throw new Error('Invalid WaveSpeed response: missing data.id');
  }

  return { inferenceId: data.data.id };
}

/**
 * Map LobeChat RuntimeVideoGenParams to WaveSpeed request body.
 *
 * WaveSpeed body shape varies by model, but the common fields below work
 * for Seedance/Kling/Veo/Wan/Hailuo/Sora/Runway/LTX/Luma as of Apr 2026.
 * Per-model overrides can be added here as we discover them.
 */
function buildBody(params: CreateVideoPayload['params']): Record<string, unknown> {
  const {
    prompt,
    imageUrl,
    endImageUrl,
    aspectRatio,
    duration,
    generateAudio,
    seed,
    resolution,
    negativePrompt,
  } = params as Record<string, unknown> & CreateVideoPayload['params'];

  const body: Record<string, unknown> = { prompt };

  if (imageUrl) body.image = imageUrl;
  if (endImageUrl) body.last_image = endImageUrl;
  if (aspectRatio !== undefined) body.aspect_ratio = aspectRatio;
  if (duration !== undefined) body.duration = duration;
  if (generateAudio !== undefined) body.enable_audio = generateAudio;
  if (seed !== undefined && seed !== null) body.seed = seed;
  if (resolution !== undefined) body.resolution = resolution;
  if (negativePrompt !== undefined) body.negative_prompt = negativePrompt;

  return body;
}
