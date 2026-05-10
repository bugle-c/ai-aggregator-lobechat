import { describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';

import { type Preset } from '@/types/preset';

import { createPresetSlice, initialPresetState, type PresetAction } from './action';

const fakePreset: Preset = {
  id: 1,
  slug: 'test',
  modality: 'image',
  modelId: 'flux-pro',
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
  it('selectPreset sets currentPreset and applies model lock', () => {
    const store = buildStore();
    store.getState().selectPreset(fakePreset);
    const s = store.getState();
    expect(s.currentPreset?.slug).toBe('test');
    expect(s.model).toBe('flux-pro');
  });

  it('selectPreset routes paramsLock entries through setParamOnInput', () => {
    const store = buildStore();
    const setParamOnInput = store.getState().setParamOnInput as ReturnType<typeof vi.fn>;
    store.getState().selectPreset(fakePreset);
    expect(setParamOnInput).toHaveBeenCalledWith('aspect_ratio', '3:4');
  });

  it('clearPreset nulls currentPreset', () => {
    const store = buildStore();
    store.getState().selectPreset(fakePreset);
    store.getState().clearPreset();
    expect(store.getState().currentPreset).toBeNull();
  });
});
