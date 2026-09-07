'use client';

import { ModelIcon } from '@lobehub/icons';
import { Button } from 'antd';
import { createStyles } from 'antd-style';
import { Lock } from 'lucide-react';
import { type AiModelForSelect } from 'model-bank';
import { memo, type ReactNode, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

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

const useStyles = createStyles(({ css, token }) => ({
  /**
   * Full-width line under the chips (flex-basis 100% + `order` puts it after
   * every chip in the wrapping row): «Стиль рассчитан на X · Переключить» or
   * «Рекомендуемая — X, на тарифе Pro Max · Тарифы». The hover tooltip on
   * the chip alone was invisible on touch and easy to miss with a mouse.
   */
  notice: css`
    display: flex;
    flex: 1 0 100%;
    gap: 6px;
    align-items: center;
    order: 99;

    min-inline-size: 0;

    font-size: 12px;
    line-height: 1.35;
    color: ${token.colorTextSecondary};
  `,
  noticeIcon: css`
    flex: 0 0 auto;
    color: ${token.colorWarning};
  `,
  noticeText: css`
    flex: 1 1 auto;
    min-inline-size: 0;
  `,
  noticeAction: css`
    flex: 0 0 auto;
    block-size: auto;
    padding: 0;
    font-size: 12px;
  `,
  warnDot: css`
    flex: 0 0 auto;

    inline-size: 6px;
    block-size: 6px;
    border-radius: 50%;

    background: ${token.colorWarning};
  `,
}));

/**
 * The model chip of the settings strip, shared by both modalities.
 *
 * Its state is relative to the selected style: no marker when the current
 * model is the recommended one; a warning dot when the user is on another
 * model (pressed «Вернуть», or picked one); a lock when the recommended
 * model is behind a higher plan. Picking a locked row in the list opens the
 * upsell instead of switching. Whenever the model differs from the
 * recommendation, a one-line notice with the way out (switch / plans) is
 * rendered under the chips.
 */
const ModelSettingsChip = memo<Props>(
  ({ currentModel, currentProvider, onPick, providers, recommendedModelId, renderModel }) => {
    const { t } = useTranslation('common');
    const { styles } = useStyles();
    const navigate = useNavigate();
    const utils = lambdaQuery.useUtils();
    const { node: upsellNode, open: openUpsell } = useLockedModelUpsell();

    const label = currentModelName(providers, currentModel) || t('preset.settings.model');

    const differs = !!recommendedModelId && recommendedModelId !== currentModel;
    const { data: recommendedLock } = useModelLockState(
      differs ? (recommendedModelId ?? undefined) : undefined,
    );
    const recommendedTarget = recommendedModelId
      ? findEnabledModel(providers, recommendedModelId)
      : null;
    const recommendedName = recommendedModelId
      ? (recommendedTarget?.displayName ?? prettifyModelId(recommendedModelId))
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
        {differs && (
          <div className={styles.notice} role="status">
            {indicator === 'locked' ? (
              <Lock className={styles.noticeIcon} size={12} />
            ) : (
              <span aria-hidden className={styles.warnDot} />
            )}
            <span className={styles.noticeText}>{tooltip}</span>
            {indicator === 'locked' ? (
              <Button
                className={styles.noticeAction}
                size="small"
                type="link"
                onClick={() => navigate('/settings/plans')}
              >
                {t('preset.plans')}
              </Button>
            ) : (
              recommendedTarget && (
                <Button
                  className={styles.noticeAction}
                  size="small"
                  type="link"
                  onClick={() =>
                    void pick(recommendedTarget.modelId, recommendedTarget.providerId, () => {})
                  }
                >
                  {t('preset.switchModel')}
                </Button>
              )
            )}
          </div>
        )}
        {upsellNode}
      </>
    );
  },
);

ModelSettingsChip.displayName = 'ModelSettingsChip';

export default ModelSettingsChip;
