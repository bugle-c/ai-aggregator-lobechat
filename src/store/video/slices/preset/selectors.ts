import { type VideoStoreState } from '../../initialState';

const currentPreset = (s: VideoStoreState) => s.currentPreset;
const hasPreset = (s: VideoStoreState) => s.currentPreset !== null;
const presetSlug = (s: VideoStoreState) => s.currentPreset?.slug ?? null;
/** True for an image-to-video style: the run is gated on `parameters.imageUrl`. */
const requiresImage = (s: VideoStoreState) => s.currentPreset?.requiresImage ?? false;

export const presetSelectors = { currentPreset, hasPreset, presetSlug, requiresImage };
