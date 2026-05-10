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

    // Try to switch to the preset's model. Aggregator providers (the
    // canonical one in this fork is `lobehub`) host every registered
    // model under the same provider id; the model-bank slug prefix
    // does NOT identify the runtime provider. We try the user's
    // currently selected provider first, then fall back to `lobehub`
    // if it differs. If neither has the model, fail soft.
    const store = this.#get();
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
