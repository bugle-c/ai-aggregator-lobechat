/**
 * WaveSpeed exposes paired endpoints per model family:
 *   `<family>/text-to-image`  ↔  `<family>/edit`
 *   `<family>/text-to-video`  ↔  `<family>/image-to-video`
 *
 * They share request shape and pricing, only the URL suffix differs. The UI
 * surfaces one card per family (T2I/T2V). When the user attaches a reference
 * image we transparently rewrite the endpoint to the edit/i2v counterpart so
 * WaveSpeed actually uses the reference instead of dropping it.
 *
 * Standalone edit-only families (qwen-image-edit, seedream-v4.5/edit,
 * seedream-v5.0-lite/edit) have no `/text-to-image` partner and are NOT in
 * these tables — the user picks them explicitly.
 *
 * Adding a new pair = one entry in the relevant table + one row in
 * `pairedEndpoint.test.ts`. The runtime call sites need no edits.
 */

const PAIRED_IMAGE_ENDPOINTS: Record<string, string> = {
  'google/nano-banana-2/text-to-image': 'google/nano-banana-2/edit',
  'google/nano-banana-pro/text-to-image': 'google/nano-banana-pro/edit',
  'openai/gpt-image-2/text-to-image': 'openai/gpt-image-2/edit',
};

const PAIRED_VIDEO_ENDPOINTS: Record<string, string> = {
  'alibaba/wan-2.7/text-to-video': 'alibaba/wan-2.7/image-to-video',
  'bytedance/seedance-2.0-fast/text-to-video': 'bytedance/seedance-2.0-fast/image-to-video',
  'bytedance/seedance-2.0/text-to-video': 'bytedance/seedance-2.0/image-to-video',
  'google/veo3.1-fast/text-to-video': 'google/veo3.1-fast/image-to-video',
  'google/veo3.1/text-to-video': 'google/veo3.1/image-to-video',
  'kwaivgi/kling-v2.6-pro/text-to-video': 'kwaivgi/kling-v2.6-pro/image-to-video',
  'kwaivgi/kling-v3.0-pro/text-to-video': 'kwaivgi/kling-v3.0-pro/image-to-video',
  'openai/sora-2/text-to-video': 'openai/sora-2/image-to-video',
};

function hasReferenceImage(params: Record<string, unknown> | undefined | null): boolean {
  if (!params) return false;
  const urls = params.imageUrls;
  if (Array.isArray(urls) && urls.length > 0) return true;
  const single = params.imageUrl;
  if (typeof single === 'string' && single.length > 0) return true;
  const legacy = params.image;
  if (typeof legacy === 'string' && legacy.length > 0) return true;
  return false;
}

export function resolveImageEndpoint(
  model: string,
  params: Record<string, unknown> | undefined | null,
): string {
  const swap = PAIRED_IMAGE_ENDPOINTS[model];
  if (!swap) return model;
  return hasReferenceImage(params) ? swap : model;
}

export function resolveVideoEndpoint(
  model: string,
  params: Record<string, unknown> | undefined | null,
): string {
  const swap = PAIRED_VIDEO_ENDPOINTS[model];
  if (!swap) return model;
  return hasReferenceImage(params) ? swap : model;
}
