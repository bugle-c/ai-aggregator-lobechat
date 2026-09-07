'use client';

import { Image as ImageIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
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
import { hasReferenceImage } from '@/features/Generators/presetImageGate';
import { presetLockedKeys, styleLockFor } from '@/features/Generators/presetLocks';
import SettingsStrip, { AdvancedItem, SettingsChip } from '@/features/Generators/SettingsStrip';
import { switchModelKeepingStyle } from '@/features/Generators/switchModelKeepingStyle';
import { useGenerationCostPreview } from '@/features/Generators/useGenerationCostPreview';
import Image from '@/libs/next/Image';
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
 * references (unless the «Фото» chip already shows them), size / quality /
 * resolution, exact width + height, steps, cfg, seed. The set depends on the
 * model only — a style never removes a knob, it locks it with a reason.
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
 * «Фото» chip body: the model's own reference uploader (multi-image when the
 * model takes `imageUrls`, single otherwise), so the photo lands in the same
 * parameter the advanced panel writes. Closes itself once a photo arrives.
 */
const PhotoPicker = memo<{
  close: () => void;
  hasPhoto: boolean;
  kind: 'multi' | 'single' | 'unsupported';
}>(({ close, hasPhoto, kind }) => {
  const { t } = useTranslation('common');
  const hadPhotoRef = useRef(hasPhoto);

  useEffect(() => {
    if (hasPhoto && !hadPhotoRef.current) close();
    hadPhotoRef.current = hasPhoto;
  }, [close, hasPhoto]);

  return (
    <div style={{ minInlineSize: 240 }}>
      {kind === 'multi' && <ImageUrlsUpload />}
      {kind === 'single' && <ImageUrl />}
      {kind === 'unsupported' && (
        <span style={{ fontSize: 12 }}>{t('preset.settings.photoUnsupported')}</span>
      )}
    </div>
  );
});

PhotoPicker.displayName = 'ImagePhotoPicker';

/** 16px thumbnail of the attached photo, as the chip's icon. */
const PhotoThumb = memo<{ src: string }>(({ src }) => (
  <span
    aria-hidden
    style={{
      blockSize: 16,
      borderRadius: 4,
      display: 'inline-block',
      flex: '0 0 auto',
      inlineSize: 16,
      overflow: 'hidden',
      position: 'relative',
    }}
  >
    <Image fill unoptimized alt="" sizes="16px" src={src} style={{ objectFit: 'cover' }} />
  </span>
));

PhotoThumb.displayName = 'ImagePhotoThumb';

const firstReference = (imageUrls: unknown, imageUrl: unknown): string | undefined => {
  if (Array.isArray(imageUrls)) {
    const first = imageUrls.find((v) => typeof v === 'string' && v.trim());
    if (typeof first === 'string') return first;
  }
  return typeof imageUrl === 'string' && imageUrl.trim() ? imageUrl : undefined;
};

/**
 * Image binding of the `SettingsStrip`:
 * `[Model ▾][Фото ▾][3:4 ▾][1 pcs ▾]` + cost / «Ещё настройки ▾» with the
 * rest of the model's knobs inline. The «Фото» chip appears for an i2i style
 * (warning dot until a reference is attached) and whenever a reference is
 * attached on a model that takes one. Used above the prompt input by the
 * desktop `FlowSidebar` and the mobile `MobileFlowContent`.
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
  const parameters = useImageStore(imageGenerationConfigSelectors.parameters);
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

  const hasPhoto =
    hasReferenceImage(parameters?.imageUrls) || hasReferenceImage(parameters?.imageUrl);
  const photoSrc = firstReference(parameters?.imageUrls, parameters?.imageUrl);
  const requiresImage = !!preset?.requiresImage;
  const supportsReference = supportsImageUrls || supportsImageUrl;
  const showPhotoChip = requiresImage || (supportsReference && hasPhoto);
  const photoKind = supportsImageUrls ? 'multi' : supportsImageUrl ? 'single' : 'unsupported';

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
    imageUrl: supportsImageUrl && !showPhotoChip,
    imageUrls: supportsImageUrls && !showPhotoChip,
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
      {showPhotoChip && (
        <SettingsChip
          ariaLabel={t('preset.settings.photo')}
          icon={photoSrc ? <PhotoThumb src={photoSrc} /> : <ImageIcon size={14} />}
          indicator={requiresImage && !hasPhoto ? 'warning' : undefined}
          label={t('preset.settings.photo')}
          content={(close) => (
            <PhotoPicker close={close} hasPhoto={hasPhoto} kind={photoKind} />
          )}
          tooltip={
            requiresImage && !hasPhoto
              ? t('preset.settings.photoMissing')
              : hasPhoto
                ? t('preset.settings.photoAttached')
                : undefined
          }
        />
      )}
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
