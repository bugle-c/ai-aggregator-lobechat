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

    // Try to switch to the preset's model under the user's CURRENT
    // provider. If the model isn't enabled in this deployment, fail
    // soft — preset card stays highlighted but user generates with
    // their currently-selected model. (See image equivalent for full
    // rationale.)
    const store = get();
    try {
      store.setModelAndProviderOnSelect(preset.modelId, store.provider);

      const { setParamOnInput } = get();
      for (const [key, value] of Object.entries(preset.paramsLock)) {
        if (value === undefined) continue;
        setParamOnInput(key as any, value as any);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        '[selectPreset] failed to apply model lock for',
        preset.slug,
        '—',
        (err as Error)?.message,
      );
    }
  },
});
