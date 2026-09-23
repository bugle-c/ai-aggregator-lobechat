import type { UserImageConfig } from '@lobechat/types';

export const MIN_DEFAULT_IMAGE_NUM = 1;
export const MAX_DEFAULT_IMAGE_NUM = 20;

// Default to 1 image per request — the previous default of 2 silently
// double-charged every generation (one click → two `usage_logs` rows,
// e.g. flux-schnell @ 18 кр × 2 = 36 кр). Users routinely don't notice
// the count selector and end up paying 2× without realising. Power
// users can still bump the slider to 2/3/4. Audit 2026-05-29: user
// `lxstvibe` lost 36 кр on a single test prompt at the 2-default.
export const DEFAULT_IMAGE_CONFIG: UserImageConfig = {
  defaultImageNum: 1,
};

/**
 * Newcomer mode (2026-09-22): free users in their first week start on this
 * model until they have `NEWCOMER_IMAGE_THRESHOLD` pictures, then the picker
 * falls back to `DEFAULT_AI_IMAGE_MODEL` (flux-schnell). Server side lives in
 * `business/server/media-router/newcomer.ts`; the router pool renders these
 * at zero provider cost.
 */
export const NEWCOMER_IMAGE_MODEL = 'google/nano-banana-2/text-to-image';
export const NEWCOMER_IMAGE_THRESHOLD = 3;
