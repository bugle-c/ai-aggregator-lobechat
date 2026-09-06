'use client';

import { Segmented, SliderWithInput } from '@lobehub/ui';
import { Image as ImageIcon } from 'lucide-react';
import { memo, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import AspectRatioSelect from '@/app/[variants]/(main)/image/_layout/ConfigPanel/components/AspectRatioSelect';
import {
  ResolutionItem,
  SeedItem,
  SwitchItem,
} from '@/app/[variants]/(main)/video/_layout/ConfigPanel';
import FrameUpload from '@/app/[variants]/(main)/video/_layout/ConfigPanel/components/FrameUpload';
import VideoModelItem from '@/app/[variants]/(main)/video/_layout/ConfigPanel/components/ModelSelect/VideoModelItem';
import ModelSettingsChip from '@/features/Generators/ModelSettingsChip';
import { hasReferenceImage } from '@/features/Generators/presetImageGate';
import SettingsStrip, { AdvancedItem, SettingsChip } from '@/features/Generators/SettingsStrip';
import { useGenerationCostPreview } from '@/features/Generators/useGenerationCostPreview';
import Image from '@/libs/next/Image';
import { useAiInfraStore } from '@/store/aiInfra';
import { aiProviderSelectors } from '@/store/aiInfra/slices/aiProvider/selectors';
import { useUserStore } from '@/store/user';
import { uiModeSelectors } from '@/store/user/slices/uiMode/selectors';
import { useVideoStore } from '@/store/video';
import { videoGenerationConfigSelectors } from '@/store/video/selectors';
import { useVideoGenerationConfigParam } from '@/store/video/slices/generationConfig/hooks';
import { presetSelectors } from '@/store/video/slices/preset/selectors';

/** A duration range with more steps than this gets a slider instead of buttons. */
const MAX_SEGMENTED_STEPS = 6;

const DEFAULT_DURATION = 5;

/** Duration chip body: the model's `min…max` by `step` as buttons when few, else a slider. */
const DurationPicker = memo<{ close: () => void }>(({ close }) => {
  const { t } = useTranslation('common');
  const { value, setValue, min, max, step, enumValues } = useVideoGenerationConfigParam('duration');

  const options = useMemo(() => {
    if (enumValues && enumValues.length > 0) return enumValues.map(Number);
    if (typeof min !== 'number' || typeof max !== 'number') return null;
    const s = step && step > 0 ? step : 1;
    if ((max - min) / s + 1 > MAX_SEGMENTED_STEPS) return null;
    const out: number[] = [];
    for (let v = min; v <= max; v += s) out.push(v);
    return out;
  }, [enumValues, max, min, step]);

  if (options) {
    return (
      <Segmented
        block
        style={{ minInlineSize: 200 }}
        value={value ?? min}
        variant="filled"
        options={options.map((v) => ({
          label: t('preset.settings.durationUnit', { count: v }),
          value: v,
        }))}
        onChange={(v) => {
          setValue(Number(v) as any);
          close();
        }}
      />
    );
  }

  return (
    <div style={{ minInlineSize: 240 }}>
      <SliderWithInput
        max={max}
        min={min}
        step={step ?? 1}
        value={value ?? min}
        onChange={(v) => setValue(v as any)}
      />
    </div>
  );
});

DurationPicker.displayName = 'VideoDurationPicker';

/**
 * «Фото» chip body: the ConfigPanel's own start-frame uploader, so the photo
 * lands in `parameters.imageUrl` exactly as if it came from ⚙. Closes itself
 * once a photo arrives — the chip then shows the thumbnail.
 */
const PhotoPicker = memo<{ close: () => void }>(({ close }) => {
  const { value } = useVideoGenerationConfigParam('imageUrl');
  const hadPhotoRef = useRef(hasReferenceImage(value));

  useEffect(() => {
    const has = hasReferenceImage(value);
    if (has && !hadPhotoRef.current) close();
    hadPhotoRef.current = has;
  }, [close, value]);

  return (
    <div style={{ minInlineSize: 240 }}>
      <FrameUpload paramName="imageUrl" />
    </div>
  );
});

PhotoPicker.displayName = 'VideoPhotoPicker';

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

PhotoThumb.displayName = 'VideoPhotoThumb';

interface AdvancedProps {
  showEndFrame: boolean;
  showResolution: boolean;
  showSeed: boolean;
  showStartFrame: boolean;
  showSwitches: { cameraFixed: boolean; generateAudio: boolean };
}

/**
 * The knobs without a chip of their own, rendered inline under the strip:
 * frames (when the «Фото» chip is not already showing the start frame),
 * resolution, seed, audio, fixed camera. Model / aspect / duration stay in
 * the chips — nothing is duplicated.
 */
const VideoAdvanced = memo<AdvancedProps>(
  ({ showEndFrame, showResolution, showSeed, showStartFrame, showSwitches }) => {
    const { t } = useTranslation('video');
    const startFrameLabel = showEndFrame
      ? t('config.imageUrl.label')
      : t('config.referenceImage.label');

    return (
      <>
        {showStartFrame && (
          <AdvancedItem label={startFrameLabel}>
            <FrameUpload paramName="imageUrl" />
          </AdvancedItem>
        )}
        {showEndFrame && (
          <AdvancedItem label={t('config.endImageUrl.label')}>
            <FrameUpload paramName="endImageUrl" />
          </AdvancedItem>
        )}
        {showResolution && (
          <AdvancedItem label={t('config.resolution.label')}>
            <ResolutionItem />
          </AdvancedItem>
        )}
        {showSeed && (
          <AdvancedItem label={t('config.seed.label')}>
            <SeedItem />
          </AdvancedItem>
        )}
        {showSwitches.generateAudio && (
          <SwitchItem label={t('config.generateAudio.label')} paramName="generateAudio" />
        )}
        {showSwitches.cameraFixed && (
          <SwitchItem label={t('config.cameraFixed.label')} paramName="cameraFixed" />
        )}
      </>
    );
  },
);

VideoAdvanced.displayName = 'VideoAdvancedSettings';

/**
 * Video binding of the `SettingsStrip`:
 * `[Model ▾][Фото ▾][16:9 ▾][5 s ▾] … [≈ 40 cr][⚙]`, with the rest of the
 * model's knobs in the inline panel ⚙ toggles. The «Фото» chip appears for
 * an i2v style (warning dot until a photo is attached) and whenever a photo
 * is attached on a model that takes one.
 */
const FlowSidebarControls = memo(() => {
  const { t } = useTranslation('common');

  const preset = useVideoStore(presetSelectors.currentPreset);
  const [model, provider] = useVideoStore((s) => [
    videoGenerationConfigSelectors.model(s),
    videoGenerationConfigSelectors.provider(s),
  ]);
  const setModelAndProviderOnSelect = useVideoStore((s) => s.setModelAndProviderOnSelect);
  const supportsAspectRatio = useVideoStore(
    videoGenerationConfigSelectors.isSupportedParam('aspectRatio'),
  );
  const supportsDuration = useVideoStore(
    videoGenerationConfigSelectors.isSupportedParam('duration'),
  );
  const supportsImageUrl = useVideoStore(
    videoGenerationConfigSelectors.isSupportedParam('imageUrl'),
  );
  const supportsEndImageUrl = useVideoStore(
    videoGenerationConfigSelectors.isSupportedParam('endImageUrl'),
  );
  const supportsResolution = useVideoStore(
    videoGenerationConfigSelectors.isSupportedParam('resolution'),
  );
  const supportsSeed = useVideoStore(videoGenerationConfigSelectors.isSupportedParam('seed'));
  const supportsGenerateAudio = useVideoStore(
    videoGenerationConfigSelectors.isSupportedParam('generateAudio'),
  );
  const supportsCameraFixed = useVideoStore(
    videoGenerationConfigSelectors.isSupportedParam('cameraFixed'),
  );
  const aspect = useVideoGenerationConfigParam('aspectRatio');
  const duration = useVideoGenerationConfigParam('duration');
  const imageUrl = useVideoStore((s) => videoGenerationConfigSelectors.parameters(s)?.imageUrl);
  const hasPhoto = hasReferenceImage(imageUrl);
  const requiresImage = !!preset?.requiresImage;
  const showPhotoChip = requiresImage || (supportsImageUrl && hasPhoto);

  const uiMode = useUserStore(uiModeSelectors.current);
  const providers = useAiInfraStore(aiProviderSelectors.enabledVideoModelListByMode(uiMode));

  const durationSeconds = Number(duration.value ?? DEFAULT_DURATION) || DEFAULT_DURATION;
  const cost = useGenerationCostPreview({ durationSeconds, kind: 'video', model });

  const aspectItems = useMemo(
    () => (aspect.enumValues ?? []).map((v) => ({ value: v })),
    [aspect.enumValues],
  );

  const showStartFrame = supportsImageUrl && !showPhotoChip;
  const hasAdvanced =
    showStartFrame ||
    supportsEndImageUrl ||
    supportsResolution ||
    supportsSeed ||
    supportsGenerateAudio ||
    supportsCameraFixed;

  return (
    <SettingsStrip
      cost={cost}
      advanced={
        hasAdvanced ? (
          <VideoAdvanced
            showEndFrame={supportsEndImageUrl}
            showResolution={supportsResolution}
            showSeed={supportsSeed}
            showStartFrame={showStartFrame}
            showSwitches={{
              cameraFixed: supportsCameraFixed,
              generateAudio: supportsGenerateAudio,
            }}
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
          <VideoModelItem {...m} providerId={providerId} showPopover={false} />
        )}
        onPick={setModelAndProviderOnSelect}
      />
      {showPhotoChip && (
        <SettingsChip
          ariaLabel={t('preset.settings.photo')}
          content={(close) => <PhotoPicker close={close} />}
          icon={hasPhoto ? <PhotoThumb src={imageUrl as string} /> : <ImageIcon size={14} />}
          indicator={requiresImage && !hasPhoto ? 'warning' : undefined}
          label={t('preset.settings.photo')}
          tooltip={
            requiresImage && !hasPhoto
              ? t('preset.settings.photoMissing')
              : hasPhoto
                ? t('preset.settings.photoAttached')
                : undefined
          }
        />
      )}
      {supportsAspectRatio && aspectItems.length > 0 && (
        <SettingsChip
          ariaLabel={t('preset.settings.aspect')}
          label={aspect.value ?? aspectItems[0].value}
          content={(close) => (
            <AspectRatioSelect
              options={aspectItems}
              value={aspect.value}
              onChange={(v) => {
                aspect.setValue(v as any);
                close();
              }}
            />
          )}
        />
      )}
      {supportsDuration && (
        <SettingsChip
          ariaLabel={t('preset.settings.duration')}
          content={(close) => <DurationPicker close={close} />}
          label={t('preset.settings.durationUnit', { count: durationSeconds })}
        />
      )}
    </SettingsStrip>
  );
});

FlowSidebarControls.displayName = 'VideoFlowSidebarControls';

export default FlowSidebarControls;
