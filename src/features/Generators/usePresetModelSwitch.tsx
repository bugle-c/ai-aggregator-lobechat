'use client';

import { App, Button } from 'antd';
import { type ReactNode, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaQuery } from '@/libs/trpc/client';
import { useAiInfraStore } from '@/store/aiInfra';
import { aiProviderSelectors } from '@/store/aiInfra/slices/aiProvider/selectors';
import { useImageStore } from '@/store/image';
import { useUserStore } from '@/store/user';
import { uiModeSelectors } from '@/store/user/slices/uiMode/selectors';
import { useVideoStore } from '@/store/video';
import type { Preset, PresetModality } from '@/types/preset';

import { currentModelName, decidePresetModelSwitch } from './presetModelSwitch';
import { useLockedModelUpsell } from './useLockedModelUpsell';

/** One key: a second quick pick replaces the toast instead of stacking one. */
const TOAST_KEY = 'preset-model-switch';
const TOAST_SECONDS = 5;
const LOCK_STALE_MS = 5 * 60 * 1000;

/**
 * What the hook needs from either generation store. Both stores satisfy
 * this structurally; picking one by modality keeps the hook usable from
 * the image and the video page without duplicating it.
 */
interface GenerationStoreLike {
  currentPreset: Preset | null;
  model?: string;
  parameters?: { prompt?: unknown } | null;
  provider?: string;
  selectPreset: (preset: Preset) => void;
  setModelAndProviderOnSelect: (model: string, provider: string) => void;
  setParamOnInput: (paramName: any, value: any) => void;
}

const storeFor = (modality: PresetModality): { getState: () => GenerationStoreLike } =>
  modality === 'image' ? useImageStore : useVideoStore;

/**
 * Per §8 of the UX spec: a free user tapping video styles should see the
 * upsell once per model per session, then only the lock in the model chip.
 */
const upsellShownKey = (modelId: string) => `upsell-shown:${modelId}`;
const markUpsellShown = (modelId: string): boolean => {
  try {
    const key = upsellShownKey(modelId);
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, '1');
    return true;
  } catch {
    return true;
  }
};

export interface PresetModelSwitch {
  /**
   * Switches to the preset's recommended model when it is enabled and not
   * tier-locked, re-applying the preset over the new model's defaults.
   * `silent` skips the toast and the upsell (deep links).
   */
  applyPresetModel: (preset: Preset, options?: { silent?: boolean }) => Promise<void>;
  /** Warm the lock query for a preset the user is hovering. */
  prefetchLock: (modelId: string | null | undefined) => void;
  /** Render once — the upsell modal / sheet the hook may open. */
  upsellNode: ReactNode;
}

/**
 * "The style brings its model." The store's `selectPreset` stays a pure
 * prompt + params write; the model decision lives here in the UI layer,
 * where the toast, the «Вернуть» undo and the tier upsell belong.
 *
 * Switching a model resets the generation parameters to that model's
 * defaults, so after every switch (and after undo) the preset is applied
 * again and the prompt the user had typed is restored.
 */
export const usePresetModelSwitch = (modality: PresetModality): PresetModelSwitch => {
  const { message } = App.useApp();
  const { t } = useTranslation('common');
  const utils = lambdaQuery.useUtils();
  const uiMode = useUserStore(uiModeSelectors.current);
  const enabled = useAiInfraStore(
    modality === 'image'
      ? aiProviderSelectors.enabledImageModelListByMode(uiMode)
      : aiProviderSelectors.enabledVideoModelListByMode(uiMode),
  );
  const { close: closeUpsell, node: upsellNode, open: openUpsell } = useLockedModelUpsell();

  const prefetchLock = useCallback(
    (modelId: string | null | undefined) => {
      if (!modelId) return;
      void utils.spend.requiredPlanForModel.prefetch({ modelId }, { staleTime: LOCK_STALE_MS });
    },
    [utils],
  );

  const applyPresetModel = useCallback(
    async (preset: Preset, options?: { silent?: boolean }) => {
      const store = storeFor(modality);
      const before = store.getState();
      const target = preset.recommendedModelId;
      if (!target || target === before.model) return;

      let lock = null;
      try {
        lock = await utils.spend.requiredPlanForModel.fetch(
          { modelId: target },
          { staleTime: LOCK_STALE_MS },
        );
      } catch {
        // Router already degrades to "unlocked" on its own errors; a
        // transport failure gets the same treatment.
      }

      // The user may have picked another style while the lock was in flight.
      if (store.getState().currentPreset?.slug !== preset.slug) return;

      const decision = decidePresetModelSwitch({
        currentModel: before.model,
        enabled,
        lock,
        recommendedModelId: target,
      });

      switch (decision.kind) {
        case 'none':
        case 'unavailable': {
          return;
        }

        case 'locked': {
          if (options?.silent || !markUpsellShown(target)) return;
          const current = currentModelName(enabled, before.model);
          openUpsell({
            fallbackAction: current
              ? { label: t('preset.continueOn', { model: current }), onClick: closeUpsell }
              : undefined,
            modelId: target,
            modelName: decision.target.displayName,
            requiredPlan: decision.requiredPlan,
          });
          return;
        }

        case 'switch': {
          const prevModel = before.model;
          const prevProvider = before.provider;
          const prevPrompt = before.parameters?.prompt;

          const applyOn = (model: string, provider: string) => {
            const s = store.getState();
            s.setModelAndProviderOnSelect(model, provider);
            // Switching resets parameters to the model's defaults: put the
            // preset's params lock and the user's own words back.
            const current = s.currentPreset;
            if (current) s.selectPreset(current);
            if (typeof prevPrompt === 'string' && prevPrompt)
              s.setParamOnInput('prompt', prevPrompt);
          };

          applyOn(decision.target.modelId, decision.target.providerId);
          if (options?.silent) return;

          const revert = () => {
            message.destroy(TOAST_KEY);
            if (prevModel && prevProvider) applyOn(prevModel, prevProvider);
          };

          message.open({
            content: (
              <span>
                {t('preset.modelSwitched', { model: decision.target.displayName })}{' '}
                <Button size="small" type="link" onClick={revert}>
                  {t('preset.revert')}
                </Button>
              </span>
            ),
            duration: TOAST_SECONDS,
            key: TOAST_KEY,
            type: 'info',
          });
          return;
        }
      }
    },
    [closeUpsell, enabled, message, modality, openUpsell, t, utils],
  );

  return useMemo(
    () => ({ applyPresetModel, prefetchLock, upsellNode }),
    [applyPresetModel, prefetchLock, upsellNode],
  );
};
