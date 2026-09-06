'use client';

import { ModelIcon } from '@lobehub/icons';
import { type AiModelForSelect } from 'model-bank';
import { memo, type ReactNode, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useModelLockState } from '@/features/UIMode';
import { lambdaQuery } from '@/libs/trpc/client';
import type { EnabledProviderWithModels } from '@/types/index';

import ModelPickerList from './ModelPickerList';
import { currentModelName, findEnabledModel } from './presetModelSwitch';
import { prettifyModelId } from './prettifyModelId';
import { SettingsChip } from './SettingsStrip';
import { useLockedModelUpsell } from './useLockedModelUpsell';

interface Props {
  currentModel: string | undefined;
  currentProvider: string | undefined;
  onPick: (modelId: string, providerId: string) => void;
  providers: readonly EnabledProviderWithModels[];
  /** The selected preset's `recommendedModelId`, to mark a mismatch. */
  recommendedModelId: string | null | undefined;
  renderModel: (model: AiModelForSelect, providerId: string) => ReactNode;
}

const LOCK_STALE_MS = 5 * 60 * 1000;

/**
 * The model chip of the settings strip, shared by both modalities.
 *
 * Its state is relative to the selected style: no marker when the current
 * model is the recommended one; a warning dot when the user is on another
 * model (pressed «Вернуть», or picked one); a lock when the recommended
 * model is behind a higher plan. Picking a locked row in the list opens the
 * upsell instead of switching.
 */
const ModelSettingsChip = memo<Props>(
  ({ currentModel, currentProvider, onPick, providers, recommendedModelId, renderModel }) => {
    const { t } = useTranslation('common');
    const utils = lambdaQuery.useUtils();
    const { node: upsellNode, open: openUpsell } = useLockedModelUpsell();

    const label = currentModelName(providers, currentModel) || t('preset.settings.model');

    const differs = !!recommendedModelId && recommendedModelId !== currentModel;
    const { data: recommendedLock } = useModelLockState(
      differs ? (recommendedModelId ?? undefined) : undefined,
    );
    const recommendedName = recommendedModelId
      ? (findEnabledModel(providers, recommendedModelId)?.displayName ??
        prettifyModelId(recommendedModelId))
      : '';

    let indicator: 'warning' | 'locked' | undefined;
    let tooltip: string | undefined;
    if (differs && recommendedLock?.isLocked) {
      indicator = 'locked';
      tooltip = t('preset.recommendedLocked', {
        model: recommendedName,
        plan: recommendedLock.requiredPlan?.name ?? '',
      });
    } else if (differs) {
      indicator = 'warning';
      tooltip = `${t('preset.styleTunedFor', { model: recommendedName })}. ${t('preset.resultMayDiffer')}`;
    }

    const pick = useCallback(
      async (modelId: string, providerId: string, close: () => void) => {
        if (modelId === currentModel && providerId === currentProvider) {
          close();
          return;
        }
        let lock: {
          isLocked: boolean;
          requiredPlan: { name: string; priceRub: number } | null;
        } | null = null;
        try {
          lock = await utils.spend.requiredPlanForModel.fetch(
            { modelId },
            { staleTime: LOCK_STALE_MS },
          );
        } catch {
          // Treated as unlocked — the server preflight is the real gate.
        }
        close();
        if (lock?.isLocked && lock.requiredPlan) {
          openUpsell({
            modelId,
            modelName:
              findEnabledModel(providers, modelId)?.displayName ?? prettifyModelId(modelId),
            requiredPlan: lock.requiredPlan,
          });
          return;
        }
        onPick(modelId, providerId);
      },
      [currentModel, currentProvider, onPick, openUpsell, providers, utils],
    );

    return (
      <>
        <SettingsChip
          ariaLabel={t('preset.settings.model')}
          icon={currentModel ? <ModelIcon model={currentModel} size={16} /> : undefined}
          indicator={indicator}
          label={label}
          tooltip={tooltip}
          content={(close) => (
            <ModelPickerList
              currentModel={currentModel}
              currentProvider={currentProvider}
              providers={providers}
              renderModel={renderModel}
              onPick={(modelId, providerId) => void pick(modelId, providerId, close)}
            />
          )}
        />
        {upsellNode}
      </>
    );
  },
);

ModelSettingsChip.displayName = 'ModelSettingsChip';

export default ModelSettingsChip;
