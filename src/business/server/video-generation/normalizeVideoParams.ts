/**
 * Reconcile parameter combinations the picker can build but upstream
 * rejects. The param-meta schema (standard-parameters/video.ts) expresses
 * independent enums — it cannot say "1080p implies 8 s" — so a user who
 * picks Veo 3.1 at 1080p and then shortens the clip gets a WaveSpeed 400
 * (`veo3.1-lite at 1080p requires duration=8s, got duration=6`, seen
 * 2026-09-21) instead of a video.
 *
 * Runs BEFORE chargeBeforeGenerate so the hold matches what is sent.
 * Policy: keep the user's duration (they deliberately shortened it) and
 * drop resolution to 720p. Veo pricing here is per second regardless of
 * resolution, so this is price-neutral for the user; extending to 8 s
 * would have billed +33 % they didn't ask for.
 */
export interface VideoParamsLike {
  [key: string]: unknown;
  duration?: number;
  resolution?: string;
}

const VEO31 = /^google\/veo3\.1(?:-lite|-fast)?\//;

export function normalizeVideoParams<T extends VideoParamsLike>(
  model: string,
  params: T,
): { changed: string[]; params: T } {
  const changed: string[] = [];
  let out = params;

  if (
    VEO31.test(model) &&
    params.resolution === '1080p' &&
    params.duration !== undefined &&
    params.duration !== 8
  ) {
    out = { ...out, resolution: '720p' };
    changed.push(
      `resolution 1080p→720p (Veo 3.1 only renders 1080p at 8 s; kept duration=${params.duration}s)`,
    );
  }

  return { changed, params: out };
}
