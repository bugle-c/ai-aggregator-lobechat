import { describe, expect, it, vi } from 'vitest';

import type { Preset } from '@/types/preset';

import { type StyleAwareStore, switchModelKeepingStyle } from './switchModelKeepingStyle';

const preset = { paramsLock: { aspect_ratio: '9:16' }, slug: 'p' } as unknown as Preset;

const makeStore = (over: Partial<StyleAwareStore> = {}) => {
  const state: StyleAwareStore = {
    currentPreset: preset,
    parameters: {
      aspectRatio: '1:1',
      imageUrl: 'https://x/p.jpg',
      prompt: 'my words',
    } as StyleAwareStore['parameters'],
    parametersSchema: { aspectRatio: {}, imageUrl: {} },
    selectPreset: vi.fn(),
    setModelAndProviderOnSelect: vi.fn(() => {
      // the store resets params to the new model's defaults
      state.parameters = { aspectRatio: '16:9' } as StyleAwareStore['parameters'];
    }),
    setParamOnInput: vi.fn((key: string, value: unknown) => {
      state.parameters = { ...state.parameters, [key]: value };
    }),
    ...over,
  };
  return state;
};

describe('switchModelKeepingStyle', () => {
  it('re-applies the style, the prompt and the photo after the model reset', () => {
    const s = makeStore();
    switchModelKeepingStyle(() => s, 'm2', 'lobehub');

    expect(s.setModelAndProviderOnSelect).toHaveBeenCalledWith('m2', 'lobehub');
    expect(s.selectPreset).toHaveBeenCalledWith(preset);
    expect(s.setParamOnInput).toHaveBeenCalledWith('prompt', 'my words');
    expect(s.setParamOnInput).toHaveBeenCalledWith('imageUrl', 'https://x/p.jpg');
  });

  it('skips the photo when the new model has no imageUrl param', () => {
    const s = makeStore({ parametersSchema: { aspectRatio: {} } });
    switchModelKeepingStyle(() => s, 'm2', 'lobehub');
    expect(s.setParamOnInput).not.toHaveBeenCalledWith('imageUrl', expect.anything());
    expect(s.setParamOnInput).toHaveBeenCalledWith('prompt', 'my words');
  });

  it('works without a style and without a prompt', () => {
    const s = makeStore({ currentPreset: null, parameters: { imageUrl: '', prompt: '' } });
    switchModelKeepingStyle(() => s, 'm2', 'lobehub');
    expect(s.selectPreset).not.toHaveBeenCalled();
    expect(s.setParamOnInput).not.toHaveBeenCalled();
  });
});
