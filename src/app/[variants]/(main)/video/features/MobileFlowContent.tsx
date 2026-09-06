'use client';

import { Flexbox } from '@lobehub/ui';
import { Button } from 'antd';
import { Sparkles } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import FrameUpload from '@/app/[variants]/(main)/video/_layout/ConfigPanel/components/FrameUpload';
import { decideGenerateReadiness } from '@/features/Generators/presetImageGate';
import PresetThumbCard from '@/features/Generators/PresetThumbCard';
import { useFlowUrlState } from '@/features/Generators/useFlowUrlState';
import { useGenerationCostPreview } from '@/features/Generators/useGenerationCostPreview';
import { useVideoGenerate } from '@/features/Generators/useVideoGenerate';
import { useVideoStore } from '@/store/video';
import { videoGenerationConfigSelectors } from '@/store/video/selectors';
import { presetSelectors } from '@/store/video/slices/preset/selectors';

import FlowSidebarControls from './FlowSidebarControls';
import PresetPromptPreview from './PresetPromptPreview';
import PromptInput from './PromptInput';

const DEFAULT_DURATION = 5;

interface Props {
  onAfterGenerate: () => void;
}

/**
 * Mirror of image/MobileFlowContent for video: style card → frame uploads
 * (when the model takes them) → prompt preview → SettingsStrip (model /
 * aspect / duration / cost / ⚙) → prompt → sticky «Сгенерировать».
 */
const MobileFlowContent = memo<Props>(({ onAfterGenerate }) => {
  const { t } = useTranslation('common');
  const url = useFlowUrlState('presets');

  const preset = useVideoStore(presetSelectors.currentPreset);
  const clearPreset = useVideoStore((s) => s.clearPreset);
  const isGenerating = useVideoStore((s) => s.isCreating);
  const parameters = useVideoStore(videoGenerationConfigSelectors.parameters);
  const generate = useVideoGenerate();
  const promptValue = (parameters?.prompt as string | undefined) ?? '';
  const duration = (parameters?.duration as number | undefined) ?? null;
  const currentModel = useVideoStore(videoGenerationConfigSelectors.model);
  const cost = useGenerationCostPreview({
    durationSeconds: duration ?? DEFAULT_DURATION,
    kind: 'video',
    model: currentModel,
  });

  // A preset is a ready prompt: with one selected, an empty input is a
  // valid one-tap run. An i2v preset additionally needs its photo
  // (`parameters.imageUrl`) — the CTA says so instead of silently greying.
  // Optional start/end frames live in the strip's inline «Дополнительные
  // настройки» (same as desktop); only the mandatory photo stays up here.
  const requiresImage = !!preset?.requiresImage;
  const readiness = decideGenerateReadiness({
    imageUrl: parameters?.imageUrl,
    isGenerating,
    preset,
    prompt: promptValue,
  });
  const canGenerate = readiness.canGenerate;
  const insufficient = cost.credits !== null && !cost.sufficient;

  const handleGenerate = async () => {
    if (!canGenerate) return;
    url.setView(undefined);
    await generate(promptValue);
    onAfterGenerate();
  };

  return (
    <Flexbox gap={12} style={{ minBlockSize: '100%' }}>
      <PresetThumbCard preset={preset} onClear={clearPreset} />

      {requiresImage && (
        <Flexbox gap={4}>
          <span
            style={{
              color: 'var(--ant-color-warning-text)',
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            {t('preset.requiresImage')}
          </span>
          <FrameUpload paramName="imageUrl" />
        </Flexbox>
      )}

      <PresetPromptPreview />

      <FlowSidebarControls />

      <PromptInput />

      <div
        style={{
          background: 'var(--ant-color-bg-layout)',
          insetBlockEnd: 0,
          marginBlockStart: 'auto',
          paddingBlockEnd: 'env(safe-area-inset-bottom, 0px)',
          paddingBlockStart: 8,
          position: 'sticky',
          zIndex: 5,
        }}
      >
        <Button
          block
          danger={insufficient}
          disabled={!canGenerate}
          icon={<Sparkles size={18} />}
          loading={isGenerating}
          size="large"
          style={{ blockSize: 48, fontWeight: 700 }}
          type="primary"
          onClick={handleGenerate}
        >
          {isGenerating
            ? t('preset.generating')
            : readiness.blocker === 'missing-image'
              ? t('preset.addPhoto')
              : cost.credits === null
                ? t('preset.generate')
                : `${t('preset.generate')} · ${t('preset.credits', { count: cost.credits })}`}
        </Button>
      </div>
    </Flexbox>
  );
});

MobileFlowContent.displayName = 'VideoMobileFlowContent';

export default MobileFlowContent;
