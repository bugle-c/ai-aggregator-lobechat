'use client';

import { memo, useMemo } from 'react';
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
import SettingsStrip, { AdvancedItem, SettingsChip } from '@/features/Generators/SettingsStrip';
import { useGenerationCostPreview } from '@/features/Generators/useGenerationCostPreview';
import { useAiInfraStore } from '@/store/aiInfra';
import { aiProviderSelectors } from '@/store/aiInfra/slices/aiProvider/selectors';
import { useImageStore } from '@/store/image';
import { imageGenerationConfigSelectors } from '@/store/image/selectors';
import { useDimensionControl } from '@/store/image/slices/generationConfig/hooks';
import { presetSelectors } from '@/store/image/slices/preset/selectors';
import { useUserStore } from '@/store/user';
import { uiModeSelectors } from '@/store/user/slices/uiMode/selectors';

interface AdvancedProps {
  showCfg: boolean;
  showDimensions: boolean;
  showImageUrl: boolean;
  showImageUrls: boolean;
  showQuality: boolean;
  showResolution: boolean;
  showSeed: boolean;
  showSize: boolean;
  showSteps: boolean;
}

/**
 * The knobs without a chip of their own, rendered inline under the strip:
 * references, size / quality / resolution, exact width + height, steps, cfg,
 * seed. Model / aspect / count stay in the chips.
 */
const ImageAdvanced = memo<AdvancedProps>(
  ({
    showCfg,
    showDimensions,
    showImageUrl,
    showImageUrls,
    showQuality,
    showResolution,
    showSeed,
    showSize,
    showSteps,
  }) => {
    const { t } = useTranslation('image');

    return (
      <>
        {showImageUrl && (
          <AdvancedItem label={t('config.imageUrl.label')}>
            <ImageUrl />
          </AdvancedItem>
        )}
        {showImageUrls && (
          <AdvancedItem label={t('config.imageUrls.label')}>
            <ImageUrlsUpload />
          </AdvancedItem>
        )}
        {showSize && (
          <AdvancedItem label={t('config.size.label')}>
            <SizeSelect />
          </AdvancedItem>
        )}
        {showQuality && (
          <AdvancedItem label={t('config.quality.label')}>
            <QualitySelect />
          </AdvancedItem>
        )}
        {showResolution && (
          <AdvancedItem label={t('config.resolution.label')}>
            <ResolutionSelect />
          </AdvancedItem>
        )}
        {showDimensions && <DimensionControlGroup />}
        {showSteps && (
          <AdvancedItem label={t('config.steps.label')}>
            <StepsSliderInput />
          </AdvancedItem>
        )}
        {showCfg && (
          <AdvancedItem label={t('config.cfg.label')}>
            <CfgSliderInput />
          </AdvancedItem>
        )}
        {showSeed && (
          <AdvancedItem label={t('config.seed.label')}>
            <SeedNumberInput />
          </AdvancedItem>
        )}
      </>
    );
  },
);

ImageAdvanced.displayName = 'ImageAdvancedSettings';

/**
 * Image binding of the `SettingsStrip`:
 * `[Model ▾][3:4 ▾][1 pcs ▾] … [≈ 12 cr][⚙]`, with the rest of the model's
 * knobs in the inline panel ⚙ toggles. Used above the prompt input by the
 * desktop `FlowSidebar` and the mobile `MobileFlowContent`.
 */
const FlowSidebarControls = memo(() => {
  const { t } = useTranslation('common');

  const preset = useImageStore(presetSelectors.currentPreset);
  const [model, provider] = useImageStore((s) => [
    imageGenerationConfigSelectors.model(s),
    imageGenerationConfigSelectors.provider(s),
  ]);
  const setModelAndProviderOnSelect = useImageStore((s) => s.setModelAndProviderOnSelect);
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

  const hasAdvanced =
    supportsImageUrl ||
    supportsImageUrls ||
    supportsSize ||
    supportsQuality ||
    supportsResolution ||
    showDimensionControl ||
    supportsSteps ||
    supportsCfg ||
    supportsSeed;

  return (
    <SettingsStrip
      cost={cost}
      advanced={
        hasAdvanced ? (
          <ImageAdvanced
            showCfg={supportsCfg}
            showDimensions={showDimensionControl}
            showImageUrl={supportsImageUrl}
            showImageUrls={supportsImageUrls}
            showQuality={supportsQuality}
            showResolution={supportsResolution}
            showSeed={supportsSeed}
            showSize={supportsSize}
            showSteps={supportsSteps}
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
        onPick={setModelAndProviderOnSelect}
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
