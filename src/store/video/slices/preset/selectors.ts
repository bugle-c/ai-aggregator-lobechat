import { type VideoStoreState } from '../../initialState';

const currentPreset = (s: VideoStoreState) => s.currentPreset;
const hasPreset = (s: VideoStoreState) => s.currentPreset !== null;
const presetSlug = (s: VideoStoreState) => s.currentPreset?.slug ?? null;

export const presetSelectors = { currentPreset, hasPreset, presetSlug };
