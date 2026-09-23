/**
 * Which requests may be served by the router pool. Pure functions, unit-tested.
 *
 * Principle: never hand the user something worse than what they picked. The
 * pool renders exactly one image (Nano Banana, 1:1 / 16:9 / 9:16) and Veo 3.1
 * **Fast** clips (16:9 / 9:16, 4/6/8/10 s, Flow's default resolution). Anything
 * outside that goes straight to WaveSpeed as today.
 */

export type RouterAspect = '1:1' | '16:9' | '9:16';

export interface ImageRoute {
  aspect: RouterAspect;
}

export interface VideoRoute {
  aspect: '16:9' | '9:16';
  /** Start frame for image→video, already an https URL (S3) or data: URI. */
  image?: string;
  seconds: 4 | 6 | 8;
}

/** Catalog ids whose Nano Banana renders the pool can substitute 1:1. */
const ROUTER_IMAGE_MODELS = new Set(['google/nano-banana-2/text-to-image']);

/**
 * Catalog video ids the pool's Veo 3.1 Fast is at least as good as:
 * Fast itself and Lite (Fast ≥ Lite). `google/veo3.1/*` (quality) is better
 * than Fast → never routed.
 */
const ROUTER_VIDEO_MODELS = new Set([
  'google/veo3.1-fast/text-to-video',
  'google/veo3.1-fast/image-to-video',
  'google/veo3.1-lite/text-to-video',
  'google/veo3.1-lite/image-to-video',
]);

const nearly = (a: number, b: number) => Math.abs(a - b) < 0.02;

/**
 * Map our image params (either `aspectRatio` or explicit width/height) onto
 * the three ratios the pool supports. Unknown / unsupported → null.
 */
export function imageAspectFor(params: {
  aspectRatio?: string | null;
  height?: number | null;
  width?: number | null;
}): RouterAspect | null {
  const ar = (params.aspectRatio ?? '').trim();
  if (ar === '1:1' || ar === '16:9' || ar === '9:16') return ar;
  if (ar) return null;
  const { width, height } = params;
  if (!width || !height) return '1:1';
  const r = width / height;
  if (nearly(r, 1)) return '1:1';
  if (nearly(r, 16 / 9)) return '16:9';
  if (nearly(r, 9 / 16)) return '9:16';
  return null;
}

export function imageRouteFor(
  model: string,
  params: {
    aspectRatio?: string | null;
    height?: number | null;
    imageUrl?: string | null;
    imageUrls?: string[] | null;
    width?: number | null;
  },
  imageNum: number,
): ImageRoute | null {
  if (!ROUTER_IMAGE_MODELS.has(model)) return null;
  if (imageNum !== 1) return null;
  if (params.imageUrl || (params.imageUrls && params.imageUrls.length > 0)) return null; // edit → WaveSpeed
  const aspect = imageAspectFor(params);
  return aspect ? { aspect } : null;
}

export function videoRouteFor(
  model: string,
  params: {
    aspectRatio?: string | null;
    duration?: number | null;
    endImageUrl?: string | null;
    imageUrl?: string | null;
    imageUrls?: string[] | null;
    resolution?: string | null;
    videoUrls?: string[] | null;
  },
  planSlug: string,
  allowedPlans: Set<string>,
): VideoRoute | null {
  if (!ROUTER_VIDEO_MODELS.has(model)) return null;
  if (!allowedPlans.has(planSlug)) return null;
  // Flow's default output; a 1080p request would come back smaller than promised.
  const res = (params.resolution ?? '720p').toLowerCase();
  if (res !== '720p') return null;
  const seconds = params.duration ?? 8;
  if (seconds !== 4 && seconds !== 6 && seconds !== 8) return null;
  const aspect = params.aspectRatio ?? '16:9';
  if (aspect !== '16:9' && aspect !== '9:16') return null;
  // Reference images/videos and end frames are Seedance/interpolation features
  // the Fast text/image→video path does not have.
  if (params.endImageUrl) return null;
  if (params.imageUrls && params.imageUrls.length > 0) return null;
  if (params.videoUrls && params.videoUrls.length > 0) return null;
  return {
    aspect,
    ...(params.imageUrl ? { image: params.imageUrl } : {}),
    seconds,
  };
}
