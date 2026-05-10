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

    // Derive provider from the canonical model_id format
    // `<provider>/<model>/<modality>`. Bare slugs (e.g. `flux-pro`)
    // fall back to the currently selected provider. We go through
    // `setModelAndProviderOnSelect` rather than `set({ model })` so the
    // model's parameter schema (and default params) get refreshed
    // before the per-param `setParamOnInput` loop applies the lock.
    const store = this.#get();
    const slashIndex = preset.modelId.indexOf('/');
    const provider = slashIndex > 0 ? preset.modelId.slice(0, slashIndex) : store.provider;
    store.setModelAndProviderOnSelect(preset.modelId, provider);

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
