import { type StateCreator } from 'zustand/vanilla';

import { normalizePresetParams } from '@/features/Generators/normalizePresetParams';
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

    // A preset is prompt + params, not a model lock. We surface
    // recommendedModelId as a hint elsewhere but don't change the
    // user's model selection here.
    // `params_lock` uses storage-side names (aspect_ratio, duration_sec);
    // the runtime schema uses camelCase (aspectRatio, duration). Translate
    // through the shared whitelist instead of spreading raw keys.
    const { setParamOnInput } = get();
    for (const { key, value } of normalizePresetParams(preset.paramsLock)) {
      setParamOnInput(key as any, value as any);
    }
  },
});
