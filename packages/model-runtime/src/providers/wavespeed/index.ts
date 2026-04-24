import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { createWaveSpeedImage } from './createImage';
import { createWaveSpeedVideo } from './video/createVideo';
import { handleWaveSpeedVideoWebhook } from './video/handleCreateVideoWebhook';

/**
 * WaveSpeed AI runtime.
 *
 * WaveSpeed is an image/video/audio inference aggregator. It does NOT expose
 * chat/completions — all calls go to `POST /api/v3/{model-slug}` with async
 * create + webhook-or-poll for the result. Chat capability below is stubbed
 * out via the OpenAI-compatible factory for LobeChat plumbing only; it will
 * never be invoked in practice because model routing sends text requests to
 * OpenRouter.
 *
 * @see https://wavespeed.ai/docs
 */
export const LobeWaveSpeedAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.wavespeed.ai/api/v3',
  createImage: createWaveSpeedImage,
  createVideo: createWaveSpeedVideo,
  debug: {
    chatCompletion: () => process.env.DEBUG_WAVESPEED_CHAT_COMPLETION === '1',
  },
  handleCreateVideoWebhook: handleWaveSpeedVideoWebhook,
  provider: ModelProvider.WaveSpeed,
});
