'use client';

import { ModelIcon } from '@lobehub/icons';
import { Segmented } from '@lobehub/ui';
import { Button } from 'antd';
import { createStyles } from 'antd-style';
import { Lock } from 'lucide-react';
import { type AiModelForSelect } from 'model-bank';
import { memo, type ReactNode, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useModelLockState } from '@/features/UIMode';
import { lambdaQuery } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';
import type { EnabledProviderWithModels } from '@/types/index';

import { familyOf, sameFamily } from './modelFamilies';
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
   * every chip in the wrapping row). The hover tooltip on the chip alone was
   * invisible on touch and easy to miss with a mouse.
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
  /** «Mini | Fast | Pro» — the family's quality tiers, one control next to the chip. */
  quality: css`
    flex: 0 0 auto;
  `,
}));

/**
 * The model chip of the settings strip, shared by both modalities.
 *
 * The marker on the chip is about the model that is *selected*:
 *   🔒 — the selected model itself is behind a higher plan (a generation on
 *        it will be refused) → «X доступна с тарифа Y · Тарифы»;
 *   ●  — the selected model is not the one the style recommends →
 *        «Стиль рассчитан на X · Переключить», or, when the recommended one
 *        is behind a higher plan, «Рекомендуемая — X, на тарифе Y · Тарифы».
 * Either way the reason and the way out are a visible line under the chips,
 * not only a hover tooltip. Picking a locked row in the list opens the
 * upsell instead of switching.
 */
const ModelSettingsChip = memo<Props>(
  ({ currentModel, currentProvider, onPick, providers, recommendedModelId, renderModel }) => {
    const { t } = useTranslation('common');
    const { styles } = useStyles();
    const navigate = useNavigate();
    const utils = lambdaQuery.useUtils();
    const { node: upsellNode, open: openUpsell } = useLockedModelUpsell();
    // requiredPlanForModel is an authed procedure — never fire it for a visitor.
    const isLogin = useUserStore(authSelectors.isLogin);

    const label = currentModelName(providers, currentModel) || t('preset.settings.model');

    // A style tuned for one Seedance 2.0 tier is a match for any tier: same
    // prompt, only the render quality differs — so no «Переключить» nag.
    const differs =
      !!recommendedModelId &&
      recommendedModelId !== currentModel &&
      !sameFamily(recommendedModelId, currentModel);

    // Quality tiers of the current model's family that the user can pick from.
    const family = familyOf(currentModel);
    const tiers = family
      ? family.variants
          .map((v) => ({ ...v, target: findEnabledModel(providers, v.modelId) }))
          .filter((v): v is typeof v & { target: NonNullable<typeof v.target> } => !!v.target)
      : [];
    const { data: currentLock } = useModelLockState(isLogin ? currentModel : undefined);
    const { data: recommendedLock } = useModelLockState(
      isLogin && differs ? (recommendedModelId ?? undefined) : undefined,
    );
    const recommendedTarget = recommendedModelId
      ? findEnabledModel(providers, recommendedModelId)
      : null;
    const recommendedName = recommendedModelId
      ? (recommendedTarget?.displayName ?? prettifyModelId(recommendedModelId))
      : '';

    let indicator: 'warning' | 'locked' | undefined;
    let notice: string | undefined;
    let action: 'plans' | 'switch' | undefined;
    if (currentLock?.isLocked) {
      indicator = 'locked';
      notice = t('preset.currentLocked', {
        model: label,
        plan: currentLock.requiredPlan?.name ?? '',
      });
      action = 'plans';
    } else if (differs && recommendedLock?.isLocked) {
      indicator = 'warning';
      notice = t('preset.recommendedLocked', {
        model: recommendedName,
        plan: recommendedLock.requiredPlan?.name ?? '',
      });
      action = 'plans';
    } else if (differs) {
      indicator = 'warning';
      notice = `${t('preset.styleTunedFor', { model: recommendedName })}. ${t('preset.resultMayDiffer')}`;
      action = recommendedTarget ? 'switch' : undefined;
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
          tooltip={notice}
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
        {tiers.length > 1 && (
          <Segmented
            aria-label={t('preset.settings.quality')}
            className={styles.quality}
            options={tiers.map((v) => ({ label: v.label, value: v.modelId }))}
            size="small"
            title={t('preset.settings.quality')}
            value={currentModel}
            variant="filled"
            onChange={(value) => {
              const tier = tiers.find((v) => v.modelId === value);
              if (tier) void pick(tier.modelId, tier.target.providerId, () => {});
            }}
          />
        )}
        {notice && (
          <div className={styles.notice} role="status">
            {indicator === 'locked' ? (
              <Lock className={styles.noticeIcon} size={12} />
            ) : (
              <span aria-hidden className={styles.warnDot} />
            )}
            <span className={styles.noticeText}>{notice}</span>
            {action === 'plans' && (
              <Button
                className={styles.noticeAction}
                size="small"
                type="link"
                onClick={() => navigate('/settings/plans')}
              >
                {t('preset.plans')}
              </Button>
            )}
            {action === 'switch' && recommendedTarget && (
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
