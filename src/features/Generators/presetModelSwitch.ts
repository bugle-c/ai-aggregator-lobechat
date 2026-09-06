import type { EnabledProviderWithModels } from '@/types/index';

import { prettifyModelId } from './prettifyModelId';

/** The provider presets are tuned for; `recommended_model_id` is its canonical model id. */
export const PRESET_MODEL_PROVIDER = 'lobehub';

export interface EnabledModelRef {
  displayName: string;
  modelId: string;
  providerId: string;
}

/**
 * Finds `modelId` among the providers the user can currently pick from
 * (`enabled*ModelListByMode(uiMode)`), preferring the branding provider
 * when several expose the same id. `null` when it is not selectable — in
 * Light mode that list is `lobehub` only; in Pro a BYOK user may have
 * disabled `lobehub` altogether.
 */
export const findEnabledModel = (
  enabled: readonly EnabledProviderWithModels[],
  modelId: string,
): EnabledModelRef | null => {
  const providers = [...enabled].sort((a, b) =>
    a.id === PRESET_MODEL_PROVIDER ? -1 : b.id === PRESET_MODEL_PROVIDER ? 1 : 0,
  );
  for (const provider of providers) {
    const model = provider.children.find((m) => m.id === modelId);
    if (model)
      return {
        displayName: model.displayName || prettifyModelId(model.id),
        modelId: model.id,
        providerId: provider.id,
      };
  }
  return null;
};

/** Readable name for whatever the user currently has selected. */
export const currentModelName = (
  enabled: readonly EnabledProviderWithModels[],
  modelId: string | undefined,
): string => {
  if (!modelId) return '';
  return findEnabledModel(enabled, modelId)?.displayName ?? prettifyModelId(modelId);
};

export interface LockState {
  isLocked: boolean;
  requiredPlan: { name: string; priceRub: number; slug: string } | null;
}

export type PresetModelDecision =
  /** No recommendation, or already on it. */
  | { kind: 'none' }
  /** Recommended model is not in the user's enabled list — leave the selection alone. */
  | { kind: 'unavailable' }
  /** Recommended model exists but the plan does not cover it — upsell, keep the model. */
  | {
      kind: 'locked';
      requiredPlan: NonNullable<LockState['requiredPlan']>;
      target: EnabledModelRef;
    }
  | { kind: 'switch'; target: EnabledModelRef };

/**
 * The four branches of the auto-switch (UX spec §4), as data. Pure so the
 * hook around it only has to fetch the lock state and act.
 */
export const decidePresetModelSwitch = (input: {
  currentModel: string | undefined;
  enabled: readonly EnabledProviderWithModels[];
  lock: LockState | null;
  recommendedModelId: string | null | undefined;
}): PresetModelDecision => {
  const { currentModel, enabled, lock, recommendedModelId } = input;
  if (!recommendedModelId || recommendedModelId === currentModel) return { kind: 'none' };

  const target = findEnabledModel(enabled, recommendedModelId);
  if (!target) return { kind: 'unavailable' };

  if (lock?.isLocked) {
    return {
      kind: 'locked',
      requiredPlan: lock.requiredPlan ?? { name: '', priceRub: 0, slug: '' },
      target,
    };
  }

  return { kind: 'switch', target };
};
