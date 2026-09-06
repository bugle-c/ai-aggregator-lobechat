import type { PresetListItem, PresetModality } from '@/types/preset';

const RATIO_RE = /^(\d+)\s*[:×x/]\s*(\d+)$/;

/**
 * The preset's own aspect ratio, read from `params_lock.aspect_ratio`
 * ("3:4", "16:9", "1:1"…), as a CSS `aspect-ratio` value.
 *
 * Only for surfaces that show the media at its true shape — currently the
 * zoom modal, which reserves the box before the mp4 has a single frame so
 * the dialog does not resize under the user's cursor. The gallery grid
 * deliberately does NOT use this (see `cardMediaAspectRatio`).
 *
 * Falls back to 3 / 4 so an untagged row never collapses to zero height.
 */
export const presetAspectRatio = (preset: PresetListItem): string => {
  const raw = preset.paramsLock?.aspect_ratio;
  if (typeof raw === 'string') {
    const m = RATIO_RE.exec(raw);
    if (m) return `${m[1]} / ${m[2]}`;
  }
  return '3 / 4';
};

/**
 * The single aspect every card in a gallery grid uses, picked per modality.
 *
 * Per-preset aspect ratios made every grid row ragged: a 9:16 card next to a
 * 16:9 one leaves the shorter card floating with dead space, and the captions
 * below them no longer line up, which is what made a ranked list hard to scan.
 * One aspect per modality keeps rows flush; the media is `object-fit: cover`d
 * into it and the true ratio stays available via `presetAspectRatio`.
 */
export const cardMediaAspectRatio = (modality: PresetModality): string =>
  modality === 'video' ? '16 / 9' : '3 / 4';
