import type { Preset } from '@/types/preset';

import { normalizePresetParams } from './normalizePresetParams';

/**
 * Why a knob is read-only while a style is selected:
 *  - `value`  — the style pins it through `params_lock` (or pins the aspect
 *               ratio, which fixes the exact width/height);
 *  - `unused` — a reference / frame input a text-driven style does not take
 *               (an i2v style takes exactly one photo, via the «Фото» chip);
 *  - `null`   — free to change.
 *
 * The advanced panel never hides a model's knob because of a style — every
 * knob stays where it always is, a locked one just says why (owner's rule:
 * «всегда видно везде одинаково, но с замочком и объяснением»).
 */
export type StyleLock = 'unused' | 'value' | null;

/** Image flow: the style's reference is `imageUrl` / `imageUrls` (i2i). */
const IMAGE_REFERENCE_INPUTS = new Set(['imageUrl', 'imageUrls']);
/**
 * Video flow: a text style takes no START frame; reference images / videos
 * (`imageUrls` / `videoUrls`, Seedance 2.0 Mini & full) are free extras the
 * user may add to any style — the prompt still drives the shot.
 */
const VIDEO_FRAME_INPUTS = new Set(['imageUrl', 'endImageUrl']);
const DIMENSION_KEYS = new Set(['height', 'width']);

/** Runtime parameter keys the style pins via `params_lock`. */
export const presetLockedKeys = (preset: Preset | null | undefined): ReadonlySet<string> =>
  new Set(preset ? normalizePresetParams(preset.paramsLock).map((p) => p.key) : []);

export const styleLockFor = (
  preset: Preset | null | undefined,
  key: string,
  lockedKeys: ReadonlySet<string> = presetLockedKeys(preset),
  modality: 'image' | 'video' = 'image',
): StyleLock => {
  if (!preset) return null;
  if (lockedKeys.has(key)) return 'value';
  if (modality === 'video') {
    // An i2v style works from one start photo; a text style from none. The
    // end frame is never part of a style.
    if (key === 'imageUrl') return preset.requiresImage ? null : 'unused';
    if (VIDEO_FRAME_INPUTS.has(key)) return 'unused';
  } else if (IMAGE_REFERENCE_INPUTS.has(key)) {
    return preset.requiresImage ? null : 'unused';
  }
  if (DIMENSION_KEYS.has(key) && lockedKeys.has('aspectRatio')) return 'value';
  return null;
};
