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

    // Try to switch to the preset's model under the user's CURRENT
    // provider. We don't derive provider from the modelId slug because
    // installations route models through aggregator providers (e.g.
    // `lobehub`) that don't match the slug prefix. If the model isn't
    // enabled for this user, fail soft — keep current model, log,
    // skip params lock.
    const store = this.#get();
    try {
      store.setModelAndProviderOnSelect(preset.modelId, store.provider);

      const { setParamOnInput } = this.#get();
      for (const [key, value] of Object.entries(preset.paramsLock)) {
        if (value === undefined) continue;
        setParamOnInput(key as any, value as any);
      }
    } catch (err) {
      // Common cause: preset references a model that's not in the
      // user's enabled list (e.g. seed slug doesn't match deployment).
      // Don't crash — UI keeps the preset card highlighted but the
      // user generates with their currently-selected model.
      // eslint-disable-next-line no-console
      console.warn(
        '[selectPreset] failed to apply model lock for',
        preset.slug,
        '—',
        (err as Error)?.message,
      );
    }
  };

  clearPreset = (): void => {
    this.#set({ currentPreset: null }, false, 'clearPreset');
  };
}

export type PresetAction = Pick<PresetActionImpl, keyof PresetActionImpl>;
