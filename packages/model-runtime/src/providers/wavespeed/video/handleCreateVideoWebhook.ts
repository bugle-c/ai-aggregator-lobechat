import createDebug from 'debug';

import type {
  HandleCreateVideoWebhookPayload,
  HandleCreateVideoWebhookResult,
} from '../../../types/video';
import type { WaveSpeedWebhookBody } from '../type';

const log = createDebug('lobe-video:wavespeed:webhook');

/**
 * Normalize a WaveSpeed webhook body into the LobeChat video-webhook shape.
 *
 * WaveSpeed statuses: `created` | `processing` | `completed` | `failed`.
 * - created/processing → pending (no-op)
 * - completed → success with outputs[0] as videoUrl
 * - failed → error
 *
 * Webhook URL includes `?token=<random>` (added by LobeChat when building
 * `callbackUrl`), verified in the generic route handler at
 * `src/app/(backend)/api/webhooks/video/[provider]/route.ts`.
 *
 * Optional defense-in-depth: WaveSpeed also signs webhooks with
 * Svix-compatible HMAC (headers `webhook-id`, `webhook-timestamp`,
 * `webhook-signature`). Verification is skipped here because the generic
 * route calls `req.json()` before invoking this handler, so the raw body
 * needed for HMAC is unavailable. The per-task token is the primary
 * security layer.
 *
 * @see https://wavespeed.ai/docs/verify-webhooks
 */
export async function handleWaveSpeedVideoWebhook(
  payload: HandleCreateVideoWebhookPayload,
): Promise<HandleCreateVideoWebhookResult> {
  const body = payload.body as WaveSpeedWebhookBody;

  log('Received WaveSpeed webhook: %O', body);

  const status = body.status;
  const inferenceId = body.id;

  if (status === 'created' || status === 'processing') {
    log('Skipping intermediate status: %s', status);
    return { status: 'pending' };
  }

  if (!inferenceId) {
    throw new Error('WaveSpeed webhook missing prediction id');
  }

  if (status === 'completed') {
    const videoUrl = body.outputs?.[0];
    if (!videoUrl) {
      throw new Error('WaveSpeed webhook missing outputs[0] on completed status');
    }

    log('Video generation succeeded: %s, videoUrl: %s', inferenceId, videoUrl);

    return {
      inferenceId,
      model: body.model,
      status: 'success' as const,
      videoUrl,
    };
  }

  // failed (or any other unexpected status)
  const errorMessage =
    (typeof body.error === 'string' && body.error) ||
    `WaveSpeed video generation failed with status: ${status}`;

  log('Video generation failed: %s, error: %s', inferenceId, errorMessage);

  return { error: errorMessage, inferenceId, status: 'error' };
}
