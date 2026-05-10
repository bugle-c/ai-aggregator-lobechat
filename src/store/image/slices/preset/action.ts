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

    // Apply model lock + params lock through the existing config slice.
    // The image store uses class-based slices; there is no single
    // `setGenerationConfig` setter — we update `model` directly and route
    // each preset param through `setParamOnInput`.
    this.#set({ model: preset.modelId }, false, `selectPreset/applyModel/${preset.modelId}`);

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
