import { type StateCreator } from 'zustand/vanilla';

import { type Preset } from '@/types/preset';

import { type VideoStore } from '../../store';

// ====== state interface ====== //

export interface PresetState {
  currentPreset: Preset | null;
}

export const initialPresetState: PresetState = {
  currentPreset: null,
};

// ====== action interface ====== //

export interface PresetAction {
  clearPreset: () => void;
  selectPreset: (preset: Preset) => void;
}

// ====== slice implementation ====== //

export const createPresetSlice: StateCreator<
  VideoStore,
  [['zustand/devtools', never]],
  [],
  PresetAction
> = (set, get) => ({
  clearPreset: () => set({ currentPreset: null }, false, 'clearPreset'),

  selectPreset: (preset) => {
    set({ currentPreset: preset }, false, `selectPreset/${preset.slug}`);

    // Apply model lock + params lock through the existing config slice.
    // The video store has no single `setGenerationConfig` setter — we
    // update `model` directly and route each preset param through
    // `setParamOnInput`. (Mirror of image-store preset slice.)
    set({ model: preset.modelId }, false, `selectPreset/applyModel/${preset.modelId}`);

    const { setParamOnInput } = get();
    for (const [key, value] of Object.entries(preset.paramsLock)) {
      if (value === undefined) continue;
      setParamOnInput(key as any, value as any);
    }
  },
});
