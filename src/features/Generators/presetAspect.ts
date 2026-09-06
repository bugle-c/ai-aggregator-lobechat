import type { PresetListItem, PresetModality } from '@/types/preset';

const RATIO_RE = /^(\d+)\s*[:×x/]\s*(\d+)$/;

/** Fallback when a row carries no usable `aspect_ratio` (portrait 3:4). */
const FALLBACK_ASPECT = 3 / 4;

/**
 * Bounds for a gallery tile, as width / height. Taller than 9:16 and the
 * tile would dominate a phone column (≤ 304px at 171px wide); wider than
 * 2:1 and it flattens into a strip. Anything outside is `object-fit: cover`ed.
 */
export const TILE_ASPECT_MIN = 9 / 16;
export const TILE_ASPECT_MAX = 2;

const parseRatio = (raw: unknown): [number, number] | null => {
  if (typeof raw !== 'string') return null;
  const m = RATIO_RE.exec(raw);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!(w > 0 && h > 0)) return null;
  return [w, h];
};

/**
 * The preset's own aspect ratio, read from `params_lock.aspect_ratio`
 * ("3:4", "16:9", "1:1"…), as a CSS `aspect-ratio` value.
 *
 * For surfaces that show the media at its true shape without a size
 * budget — the zoom modal, which reserves the box before the mp4 has a
 * single frame so the dialog does not resize under the user's cursor.
 *
 * Falls back to 3 / 4 so an untagged row never collapses to zero height.
 */
export const presetAspectRatio = (preset: PresetListItem): string => {
  const parsed = parseRatio(preset.paramsLock?.aspect_ratio);
  return parsed ? `${parsed[0]} / ${parsed[1]}` : '3 / 4';
};

/**
 * The gallery tile's aspect as a number (width / height): the real ratio
 * clamped to `[TILE_ASPECT_MIN, TILE_ASPECT_MAX]`.
 *
 * This is what the masonry layout does its arithmetic with — tile height is
 * `columnWidth / tileAspectNumber(preset)`, computed before anything is
 * measured or loaded, so the layout never depends on media arriving.
 */
export const tileAspectNumber = (preset: PresetListItem): number => {
  const parsed = parseRatio(preset.paramsLock?.aspect_ratio);
  const ratio = parsed ? parsed[0] / parsed[1] : FALLBACK_ASPECT;
  return Math.min(TILE_ASPECT_MAX, Math.max(TILE_ASPECT_MIN, ratio));
};

/** `tileAspectNumber` as a CSS `aspect-ratio` value for the tile's media box. */
export const tileAspectRatio = (preset: PresetListItem): string =>
  `${tileAspectNumber(preset)} / 1`;

/**
 * One aspect for every card in a *home-page row* (`HomePresetSection`,
 * `HomeVideoSection`), picked per modality. A single flush row of five
 * thumbnails wants equal heights; the gallery itself uses the real ratio
 * via `tileAspectRatio` and lays tiles out as a masonry.
 */
export const cardMediaAspectRatio = (modality: PresetModality): string =>
  modality === 'video' ? '16 / 9' : '3 / 4';
