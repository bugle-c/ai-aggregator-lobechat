import { type ImageStoreState } from '../../initialState';

const currentPreset = (s: ImageStoreState) => s.currentPreset;
const hasPreset = (s: ImageStoreState) => s.currentPreset !== null;
const presetSlug = (s: ImageStoreState) => s.currentPreset?.slug ?? null;

export const presetSelectors = { currentPreset, hasPreset, presetSlug };
