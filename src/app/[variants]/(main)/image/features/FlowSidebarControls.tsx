'use client';

import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AspectRatioSelect from '@/app/[variants]/(main)/image/_layout/ConfigPanel/components/AspectRatioSelect';
import CfgSliderInput from '@/app/[variants]/(main)/image/_layout/ConfigPanel/components/CfgSliderInput';
import DimensionControlGroup from '@/app/[variants]/(main)/image/_layout/ConfigPanel/components/DimensionControlGroup';
import ImageNum from '@/app/[variants]/(main)/image/_layout/ConfigPanel/components/ImageNum';
import ImageUrl from '@/app/[variants]/(main)/image/_layout/ConfigPanel/components/ImageUrl';
import ImageUrlsUpload from '@/app/[variants]/(main)/image/_layout/ConfigPanel/components/ImageUrlsUpload';
import ImageModelItem from '@/app/[variants]/(main)/image/_layout/ConfigPanel/components/ModelSelect/ImageModelItem';
import QualitySelect from '@/app/[variants]/(main)/image/_layout/ConfigPanel/components/QualitySelect';
import ResolutionSelect from '@/app/[variants]/(main)/image/_layout/ConfigPanel/components/ResolutionSelect';
import SeedNumberInput from '@/app/[variants]/(main)/image/_layout/ConfigPanel/components/SeedNumberInput';
import SizeSelect from '@/app/[variants]/(main)/image/_layout/ConfigPanel/components/SizeSelect';
import StepsSliderInput from '@/app/[variants]/(main)/image/_layout/ConfigPanel/components/StepsSliderInput';
import ModelSettingsChip from '@/features/Generators/ModelSettingsChip';
import { presetLockedKeys, styleLockFor } from '@/features/Generators/presetLocks';
import SettingsStrip, { AdvancedItem, SettingsChip } from '@/features/Generators/SettingsStrip';
import { switchModelKeepingStyle } from '@/features/Generators/switchModelKeepingStyle';
import { useGenerationCostPreview } from '@/features/Generators/useGenerationCostPreview';
import { useAiInfraStore } from '@/store/aiInfra';
import { aiProviderSelectors } from '@/store/aiInfra/slices/aiProvider/selectors';
import { useImageStore } from '@/store/image';
import { imageGenerationConfigSelectors } from '@/store/image/selectors';
import { useDimensionControl } from '@/store/image/slices/generationConfig/hooks';
import { presetSelectors } from '@/store/image/slices/preset/selectors';
import { useUserStore } from '@/store/user';
import { uiModeSelectors } from '@/store/user/slices/uiMode/selectors';

type Knob =
  | 'cfg'
  | 'dimensions'
  | 'imageUrl'
  | 'imageUrls'
  | 'quality'
  | 'resolution'
  | 'seed'
  | 'size'
  | 'steps';

interface AdvancedProps {
  /** Per-knob lock reason under the selected style; `undefined` = free. */
  locks: Partial<Record<Knob, string>>;
  /** «Точный размер, px» — from the common namespace, hence passed in. */
  pixelSizeLabel: string;
  /** Which knobs the current model has at all. */
  show: Record<Knob, boolean>;
}

/**
 * The knobs without a chip of their own, rendered inline under the strip:
 * references, size / quality / resolution, exact width + height, steps, cfg,
 * seed. The set depends on the model only — a style never removes a knob,
 * it locks it with a reason.
 */
const ImageAdvanced = memo<AdvancedProps>(({ locks, pixelSizeLabel, show }) => {
  const { t } = useTranslation('image');

  return (
    <>
      {show.imageUrl && (
        <AdvancedItem label={t('config.imageUrl.label')} lock={locks.imageUrl}>
          <ImageUrl />
        </AdvancedItem>
      )}
      {show.imageUrls && (
        <AdvancedItem label={t('config.imageUrls.label')} lock={locks.imageUrls}>
          <ImageUrlsUpload />
        </AdvancedItem>
      )}
      {show.size && (
        <AdvancedItem label={t('config.size.label')} lock={locks.size}>
          <SizeSelect />
        </AdvancedItem>
      )}
      {show.quality && (
        <AdvancedItem label={t('config.quality.label')} lock={locks.quality}>
          <QualitySelect />
        </AdvancedItem>
      )}
      {show.resolution && (
        <AdvancedItem label={t('config.resolution.label')} lock={locks.resolution}>
          <ResolutionSelect />
        </AdvancedItem>
      )}
      {show.dimensions && (
        <AdvancedItem label={pixelSizeLabel} lock={locks.dimensions}>
          <DimensionControlGroup hideAspectRatio />
        </AdvancedItem>
      )}
      {show.steps && (
        <AdvancedItem label={t('config.steps.label')} lock={locks.steps}>
          <StepsSliderInput />
        </AdvancedItem>
      )}
      {show.cfg && (
        <AdvancedItem label={t('config.cfg.label')} lock={locks.cfg}>
          <CfgSliderInput />
        </AdvancedItem>
      )}
      {show.seed && (
        <AdvancedItem label={t('config.seed.label')} lock={locks.seed}>
          <SeedNumberInput />
        </AdvancedItem>
      )}
    </>
  );
});

ImageAdvanced.displayName = 'ImageAdvancedSettings';

/**
 * Image binding of the `SettingsStrip`:
 * `[Model ▾][3:4 ▾][1 pcs ▾]` + cost / «Ещё настройки ▾» with the rest of
 * the model's knobs inline. Used above the prompt input by the desktop
 * `FlowSidebar` and the mobile `MobileFlowContent`.
 */
const FlowSidebarControls = memo(() => {
  const { t } = useTranslation('common');

  const preset = useImageStore(presetSelectors.currentPreset);
  const [model, provider] = useImageStore((s) => [
    imageGenerationConfigSelectors.model(s),
    imageGenerationConfigSelectors.provider(s),
  ]);
  const imageNum = useImageStore(imageGenerationConfigSelectors.imageNum);
  const isSupported = imageGenerationConfigSelectors.isSupportedParam;
  const supportsAspectRatio = useImageStore(isSupported('aspectRatio'));
  const supportsImageUrl = useImageStore(isSupported('imageUrl'));
  const supportsImageUrls = useImageStore(isSupported('imageUrls'));
  const supportsSize = useImageStore(isSupported('size'));
  const supportsQuality = useImageStore(isSupported('quality'));
  const supportsResolution = useImageStore(isSupported('resolution'));
  const supportsSteps = useImageStore(isSupported('steps'));
  const supportsCfg = useImageStore(isSupported('cfg'));
  const supportsSeed = useImageStore(isSupported('seed'));
  // Goes through the dimension controller rather than a raw param write so
  // width/height follow the ratio the same way they do in ConfigPanel.
  const {
    aspectRatio,
    options: aspectOptions,
    setAspectRatio,
    showDimensionControl,
  } = useDimensionControl();

  const uiMode = useUserStore(uiModeSelectors.current);
  const providers = useAiInfraStore(aiProviderSelectors.enabledImageModelListByMode(uiMode));

  const cost = useGenerationCostPreview({ images: imageNum, kind: 'image', model });

  const aspectItems = useMemo(() => aspectOptions.map((v) => ({ value: v })), [aspectOptions]);

  // Picking a model resets its params — keep the style, prompt and reference.
  const pickModel = useCallback(
    (modelId: string, providerId: string) =>
      switchModelKeepingStyle(useImageStore.getState, modelId, providerId),
    [],
  );

  const lockedKeys = useMemo(() => presetLockedKeys(preset), [preset]);
  const lockReason = (key: string): string | undefined => {
    const lock = styleLockFor(preset, key, lockedKeys);
    if (lock === 'value') return t('preset.settings.lockedByStyle');
    if (lock === 'unused') return t('preset.settings.unusedByStyle');
    return undefined;
  };

  const show: Record<Knob, boolean> = {
    cfg: supportsCfg,
    dimensions: showDimensionControl,
    imageUrl: supportsImageUrl,
    imageUrls: supportsImageUrls,
    quality: supportsQuality,
    resolution: supportsResolution,
    seed: supportsSeed,
    size: supportsSize,
    steps: supportsSteps,
  };
  const hasAdvanced = Object.values(show).some(Boolean);
  const locks: Partial<Record<Knob, string>> = {
    cfg: lockReason('cfg'),
    dimensions: lockReason('width'),
    imageUrl: lockReason('imageUrl'),
    imageUrls: lockReason('imageUrls'),
    quality: lockReason('quality'),
    resolution: lockReason('resolution'),
    seed: lockReason('seed'),
    size: lockReason('size'),
    steps: lockReason('steps'),
  };

  return (
    <SettingsStrip
      cost={cost}
      advanced={
        hasAdvanced ? (
          <ImageAdvanced
            locks={locks}
            pixelSizeLabel={t('preset.settings.pixelSize')}
            show={show}
          />
        ) : undefined
      }
    >
      <ModelSettingsChip
        currentModel={model}
        currentProvider={provider}
        providers={providers}
        recommendedModelId={preset?.recommendedModelId}
        renderModel={(m, providerId) => (
          <ImageModelItem {...m} providerId={providerId} showPopover={false} />
        )}
        onPick={pickModel}
      />
      {supportsAspectRatio && (
        <SettingsChip
          ariaLabel={t('preset.settings.aspect')}
          label={aspectRatio}
          content={(close) => (
            <AspectRatioSelect
              options={aspectItems}
              value={aspectRatio}
              onChange={(v) => {
                setAspectRatio(v);
                close();
              }}
            />
          )}
        />
      )}
      <SettingsChip
        ariaLabel={t('preset.settings.count')}
        label={t('preset.settings.countUnit', { count: imageNum })}
        content={() => (
          <div style={{ minInlineSize: 240 }}>
            <ImageNum />
          </div>
        )}
      />
    </SettingsStrip>
  );
});

FlowSidebarControls.displayName = 'ImageFlowSidebarControls';

export default FlowSidebarControls;
