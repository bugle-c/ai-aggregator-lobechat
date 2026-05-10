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

    // Derive provider from the canonical model_id format
    // `<provider>/<model>/<modality>`. Bare slugs fall back to the
    // currently selected provider. `setModelAndProviderOnSelect`
    // refreshes the model's parameter schema before we apply the
    // per-param lock.
    const store = get();
    const slashIndex = preset.modelId.indexOf('/');
    const provider = slashIndex > 0 ? preset.modelId.slice(0, slashIndex) : store.provider;
    store.setModelAndProviderOnSelect(preset.modelId, provider);

    const { setParamOnInput } = get();
    for (const [key, value] of Object.entries(preset.paramsLock)) {
      if (value === undefined) continue;
      setParamOnInput(key as any, value as any);
    }
  },
});
