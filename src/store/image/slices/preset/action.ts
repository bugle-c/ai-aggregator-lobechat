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

    // This action stays a pure prompt + params write. Switching to
    // `recommendedModelId` (with its toast, «Вернуть» undo and tier
    // upsell) is UI-layer work — see `usePresetModelSwitch`, which also
    // re-runs this action after a switch because changing the model
    // resets the parameters to that model's defaults.
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
