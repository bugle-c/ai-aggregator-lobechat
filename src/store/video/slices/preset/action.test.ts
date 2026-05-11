// Isolated unit test — instantiates a vanilla zustand store with just
// the preset slice and a `setParamOnInput` spy so we test the slice
// without dragging in the full video store (which transitively loads
// @lobehub/editor and breaks under vitest's ESM resolution).
import { describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';

import type { Preset } from '@/types/preset';

import { createPresetSlice, initialPresetState } from './action';

const fakePreset: Preset = {
  badges: ['new'],
  category: 'camera',
  description: null,
  id: 1,
  modality: 'video',
  recommendedModelId: 'kwaivgi/kling-v3.0-pro/text-to-video',
  paramsLock: { aspect_ratio: '16:9', duration_sec: 5 },
  previewUrl: 'https://example.com/x.mp4',
  promptTemplate: 'Crash zoom into {{user_prompt}}',
  slug: 'crash-zoom-in',
  sortOrder: 10,
  title: 'Crash Zoom In',
};

const buildIsolatedStore = () => {
  const setParamOnInput = vi.fn();
  const store = createStore<any>()((set, get, api) => ({
    ...initialPresetState,
    model: undefined,
    setParamOnInput,
    ...createPresetSlice(set as any, get as any, api as any),
  }));
  return { setParamOnInput, store };
};

describe('video preset slice', () => {
  it('selectPreset sets currentPreset', () => {
    const { store } = buildIsolatedStore();
    store.getState().selectPreset(fakePreset);
    expect(store.getState().currentPreset?.slug).toBe('crash-zoom-in');
  });

  it('selectPreset routes paramsLock entries through setParamOnInput', () => {
    const { setParamOnInput, store } = buildIsolatedStore();
    store.getState().selectPreset(fakePreset);
    expect(setParamOnInput).toHaveBeenCalledWith('aspect_ratio', '16:9');
    expect(setParamOnInput).toHaveBeenCalledWith('duration_sec', 5);
  });

  it('clearPreset nulls currentPreset', () => {
    const { store } = buildIsolatedStore();
    store.getState().selectPreset(fakePreset);
    store.getState().clearPreset();
    expect(store.getState().currentPreset).toBeNull();
  });
});
