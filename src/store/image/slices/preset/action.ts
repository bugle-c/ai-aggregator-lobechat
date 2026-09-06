import { normalizePresetParams } from '@/features/Generators/normalizePresetParams';
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
    // `params_lock` uses storage-side names (aspect_ratio, duration_sec);
    // the runtime schema uses camelCase (aspectRatio, duration). Translate
    // through the shared whitelist instead of spreading raw keys.
    const { setParamOnInput } = this.#get();
    for (const { key, value } of normalizePresetParams(preset.paramsLock)) {
      setParamOnInput(key as any, value as any);
    }
  };

  clearPreset = (): void => {
    this.#set({ currentPreset: null }, false, 'clearPreset');
  };
}

export type PresetAction = Pick<PresetActionImpl, keyof PresetActionImpl>;
