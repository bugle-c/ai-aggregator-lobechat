import { type StoreSetter } from '@/store/types';
import { type Preset } from '@/types/preset';

import { type ImageStore } from '../../store';

// ====== state interface ====== //

export interface PresetState {
  currentPreset: Preset | null;
}

export const initialPresetState: PresetState = {
  currentPreset: null,
};

// ====== action implementation ====== //

type Setter = StoreSetter<ImageStore>;
export const createPresetSlice = (set: Setter, get: () => ImageStore, _api?: unknown) =>
  new PresetActionImpl(set, get, _api);

export class PresetActionImpl {
  readonly #get: () => ImageStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ImageStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  selectPreset = (preset: Preset): void => {
    this.#set({ currentPreset: preset }, false, `selectPreset/${preset.slug}`);

    // We're an aggregator; the user picks the model. A preset is
    // prompt + curated params, not a model lock. The recommendedModelId
    // is surfaced as a hint in the UI but never switches the selection.
    const { setParamOnInput } = this.#get();
    for (const [key, value] of Object.entries(preset.paramsLock)) {
      if (value === undefined) continue;
      setParamOnInput(key as any, value as any);
    }
  };

  clearPreset = (): void => {
    this.#set({ currentPreset: null }, false, 'clearPreset');
  };
}

export type PresetAction = Pick<PresetActionImpl, keyof PresetActionImpl>;
