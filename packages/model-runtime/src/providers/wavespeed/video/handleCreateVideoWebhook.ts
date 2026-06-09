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

    // Extract requested duration from the input echo so chargeAfterGenerate
    // has authoritative seconds to bill against. Without this the webhook
    // returned no `usage` and the route fell through to ffmpeg-derived
    // duration; if ffmpeg failed to parse a short clip it produced
    // durationSeconds=0 and chargeAfterGenerate skipped writeUsageLog
    // entirely — the user got the video free. This was the 06-05 mismatch
    // (WS billed 8 calls, our usage_logs had 4).
    //
    // Provider-specific quirk: WaveSpeed echoes back the original request
    // payload under `body.input`, so the duration we sent in createVideo
    // round-trips here. If the user didn't pass `duration` we omit it and
    // the route's later fallbacks still apply.
    const inputDuration = (body.input as { duration?: number } | undefined)?.duration;
    const durationSeconds =
      typeof inputDuration === 'number' && inputDuration > 0 ? inputDuration : undefined;

    return {
      inferenceId,
      model: body.model,
      status: 'success' as const,
      ...(durationSeconds !== undefined && {
        usage: { completionTokens: 0, durationSeconds, totalTokens: 0 },
      }),
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
