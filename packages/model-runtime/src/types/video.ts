// Note: the prior `eslint-disable typescript-sort-keys/interface` directive
// was removed in 2026-06-09 because the shared eslint config no longer ships
// that plugin, and the directive triggered "rule not found" hard-errors in
// husky pre-commit on any file touching this module.
import type { RuntimeVideoGenParams } from 'model-bank';

export type CreateVideoPayload = {
  callbackUrl?: string;
  model: string;
  params: RuntimeVideoGenParams;
};

export type CreateVideoResponse = {
  inferenceId: string;
};

export type HandleCreateVideoWebhookPayload = {
  body: unknown;
  headers?: Record<string, string>;
};

export type HandleCreateVideoWebhookResult =
  | { status: 'pending' }
  | {
      generateAudio?: boolean;
      inferenceId: string;
      model?: string;
      status: 'success';
      // `durationSeconds` is the field chargeAfterGenerate needs for video
      // billing. Providers that echo back the requested duration (e.g.
      // WaveSpeed via `body.input.duration`) fill it in their per-provider
      // handler so the webhook → chargeAfter pipeline never falls through
      // to the ffmpeg-derived duration (which can be 0 for short clips and
      // causes a silent skip of writeUsageLog).
      usage?: { completionTokens: number; durationSeconds?: number; totalTokens: number };
      videoUrl: string;
    }
  | { error: string; inferenceId: string; status: 'error' };
