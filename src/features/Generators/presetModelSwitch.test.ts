import { describe, expect, it } from 'vitest';

import type { EnabledProviderWithModels } from '@/types/index';

import { currentModelName, decidePresetModelSwitch, findEnabledModel } from './presetModelSwitch';

const NANO = 'google/nano-banana-pro/text-to-image';
const GPT = 'openai/gpt-image-2/text-to-image';

const provider = (id: string, models: { displayName?: string; id: string }[]) =>
  ({
    children: models.map((m) => ({ abilities: {}, ...m })),
    id,
    name: id,
    source: 'builtin',
  }) as unknown as EnabledProviderWithModels;

const enabled = [
  provider('openrouter', [{ id: NANO }]),
  provider('lobehub', [{ displayName: 'Nano Banana Pro', id: NANO }, { id: GPT }]),
];

describe('findEnabledModel', () => {
  it('prefers the lobehub provider when several expose the model', () => {
    expect(findEnabledModel(enabled, NANO)).toEqual({
      displayName: 'Nano Banana Pro',
      modelId: NANO,
      providerId: 'lobehub',
    });
  });

  it('falls back to a prettified id when the model has no displayName', () => {
    expect(findEnabledModel(enabled, GPT)?.displayName).toBe('Gpt Image 2');
    expect(currentModelName(enabled, GPT)).toBe('Gpt Image 2');
    expect(currentModelName([], GPT)).toBe('Gpt Image 2');
    expect(currentModelName(enabled, undefined)).toBe('');
  });

  it('returns null for a model no enabled provider offers', () => {
    expect(findEnabledModel(enabled, 'x/y/z')).toBeNull();
  });
});

describe('decidePresetModelSwitch', () => {
  const unlocked = { isLocked: false, requiredPlan: null };
  const locked = {
    isLocked: true,
    requiredPlan: { name: 'Базовый', priceRub: 490, slug: 'basic' },
  };

  it('does nothing without a recommendation or when already on it', () => {
    expect(
      decidePresetModelSwitch({
        currentModel: GPT,
        enabled,
        lock: unlocked,
        recommendedModelId: null,
      }),
    ).toEqual({ kind: 'none' });
    expect(
      decidePresetModelSwitch({
        currentModel: NANO,
        enabled,
        lock: locked,
        recommendedModelId: NANO,
      }),
    ).toEqual({ kind: 'none' });
  });

  it('leaves the selection alone when the model is not enabled (Light / BYOK)', () => {
    const lightList = [provider('lobehub', [{ id: GPT }])];
    expect(
      decidePresetModelSwitch({
        currentModel: GPT,
        enabled: lightList,
        lock: unlocked,
        recommendedModelId: NANO,
      }),
    ).toEqual({ kind: 'unavailable' });
  });

  it('reports a locked model with the plan to upsell, without switching', () => {
    expect(
      decidePresetModelSwitch({
        currentModel: GPT,
        enabled,
        lock: locked,
        recommendedModelId: NANO,
      }),
    ).toEqual({
      kind: 'locked',
      requiredPlan: locked.requiredPlan,
      target: findEnabledModel(enabled, NANO),
    });
  });

  it('switches when the model is enabled and not locked (lock unknown counts as open)', () => {
    const target = findEnabledModel(enabled, NANO);
    expect(
      decidePresetModelSwitch({
        currentModel: GPT,
        enabled,
        lock: unlocked,
        recommendedModelId: NANO,
      }),
    ).toEqual({ kind: 'switch', target });
    expect(
      decidePresetModelSwitch({ currentModel: GPT, enabled, lock: null, recommendedModelId: NANO }),
    ).toEqual({ kind: 'switch', target });
  });
});
