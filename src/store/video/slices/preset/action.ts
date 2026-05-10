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

    // Try to switch to the preset's model — try current provider
    // first, fall back to `lobehub` (the aggregator that hosts every
    // registered video model under one provider id). If neither
    // works, fail soft. (See image preset slice for rationale.)
    const store = get();
    const tryApply = (provider: string): boolean => {
      try {
        store.setModelAndProviderOnSelect(preset.modelId, provider);
        return true;
      } catch {
        return false;
      }
    };

    try {
      const ok = tryApply(store.provider) || (store.provider !== 'lobehub' && tryApply('lobehub'));
      if (!ok) {
        throw new Error(`Model "${preset.modelId}" not enabled for any active provider.`);
      }

      const { setParamOnInput } = get();
      for (const [key, value] of Object.entries(preset.paramsLock)) {
        if (value === undefined) continue;
        setParamOnInput(key as any, value as any);
      }
    } catch (err) {
      console.warn(
        '[selectPreset] failed to apply model lock for',
        preset.slug,
        '—',
        (err as Error)?.message,
      );
    }
  },
});
