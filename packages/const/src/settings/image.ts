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
