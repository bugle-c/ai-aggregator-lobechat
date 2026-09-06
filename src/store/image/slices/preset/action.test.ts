import { describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';

import { type Preset } from '@/types/preset';

import { createPresetSlice, initialPresetState, type PresetAction } from './action';

const fakePreset: Preset = {
  authorAvatar: null,
  authorName: null,
  authorUrl: null,
  externalId: null,
  ingestedAt: null,
  license: null,
  popularity: null,
  posterUrl: null,
  requiresImage: false,
  sourcePlatform: null,
  sourceUrl: null,
  id: 1,
  slug: 'test',
  modality: 'image',
  recommendedModelId: 'flux-pro',
  category: 'portrait',
  title: 'Test',
  description: null,
  promptTemplate: 'foo {{user_prompt}}',
  paramsLock: { aspect_ratio: '3:4' },
  previewUrl: 'https://example.com/x.mp4',
  badges: ['new'],
  sortOrder: 1,
};

/**
 * Build a minimal isolated store containing only the preset slice and the
 * pieces of state/actions it touches (`model`, `setParamOnInput`).
 *
 * Avoids importing `useImageStore` so this test does not transitively pull
 * in `@lobehub/ui` and other DOM-heavy dependencies that the broader image
 * store drags in.
 */
const buildStore = () => {
  const setParamOnInput = vi.fn();
  return createStore<
    PresetAction & {
      currentPreset: Preset | null;
      model: string | null;
      setParamOnInput: (key: string, value: unknown) => void;
    }
  >((set, get, api) => {
    const slice = createPresetSlice(set as never, get as never, api);
    return {
      ...initialPresetState,
      model: null,
      setParamOnInput,
      selectPreset: slice.selectPreset,
      clearPreset: slice.clearPreset,
    };
  });
};

describe('image preset slice', () => {
  it('selectPreset sets currentPreset and does NOT auto-switch model', () => {
    const store = buildStore();
    store.getState().selectPreset(fakePreset);
    const s = store.getState();
    expect(s.currentPreset?.slug).toBe('test');
    // The architectural promise: preset selection never yanks the model.
    expect(s.model).toBeNull();
  });

  it('selectPreset maps paramsLock storage keys to runtime param keys', () => {
    const store = buildStore();
    const setParamOnInput = store.getState().setParamOnInput as ReturnType<typeof vi.fn>;
    store.getState().selectPreset(fakePreset);
    // `aspect_ratio` is the storage name; the generation schema declares
    // `aspectRatio`. Passing the raw key silently dropped the value.
    expect(setParamOnInput).toHaveBeenCalledWith('aspectRatio', '3:4');
    expect(setParamOnInput).not.toHaveBeenCalledWith('aspect_ratio', '3:4');
  });

  it('selectPreset ignores params_lock keys that are not generation params', () => {
    const store = buildStore();
    const setParamOnInput = store.getState().setParamOnInput as ReturnType<typeof vi.fn>;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    store.getState().selectPreset({ ...fakePreset, paramsLock: { nonsense_key: 42 } });
    expect(setParamOnInput).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('clearPreset nulls currentPreset', () => {
    const store = buildStore();
    store.getState().selectPreset(fakePreset);
    store.getState().clearPreset();
    expect(store.getState().currentPreset).toBeNull();
  });
});
