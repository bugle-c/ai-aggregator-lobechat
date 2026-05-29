'use client';

import { Flexbox } from '@lobehub/ui';
import { Segmented } from 'antd';
import { Settings, Sparkles } from 'lucide-react';
import { memo } from 'react';

import FrameUpload from '@/app/[variants]/(main)/video/_layout/ConfigPanel/components/FrameUpload';
import ModelSelect from '@/app/[variants]/(main)/video/_layout/ConfigPanel/components/ModelSelect';
import PresetThumbCard from '@/features/Generators/PresetThumbCard';
import { useFlowUrlState } from '@/features/Generators/useFlowUrlState';
import { useGenerationCostPreview } from '@/features/Generators/useGenerationCostPreview';
import { useVideoGenerate } from '@/features/Generators/useVideoGenerate';
import { useVideoStore } from '@/store/video';
import { videoGenerationConfigSelectors } from '@/store/video/selectors';
import { presetSelectors } from '@/store/video/slices/preset/selectors';

import PromptInput from './PromptInput';

const ASPECT_OPTIONS = ['16:9', '9:16', '1:1'];
const DURATION_OPTIONS = [
  { label: '5 сек', value: 5 },
  { label: '10 сек', value: 10 },
];

interface Props {
  onAfterGenerate: () => void;
  onOpenSettings: () => void;
}

/**
 * Mirror of image/MobileFlowContent + duration_sec selector.
 */
const MobileFlowContent = memo<Props>(({ onAfterGenerate, onOpenSettings }) => {
  const url = useFlowUrlState('presets');

  const preset = useVideoStore(presetSelectors.currentPreset);
  const clearPreset = useVideoStore((s) => s.clearPreset);
  const isGenerating = useVideoStore((s) => s.isCreating);
  const setParamOnInput = useVideoStore((s) => s.setParamOnInput);
  const parameters = useVideoStore(videoGenerationConfigSelectors.parameters);
  const generate = useVideoGenerate();
  const promptValue = (parameters?.prompt as string | undefined) ?? '';
  const aspect = (parameters?.aspectRatio as string | undefined) ?? null;
  const duration = (parameters?.duration as number | undefined) ?? null;
  const currentModel = useVideoStore(videoGenerationConfigSelectors.model);
  // Default to 5s when the slider hasn't been touched yet — matches the
  // common Wavespeed model default. Keeps the preview from flashing 0.
  const cost = useGenerationCostPreview({
    durationSeconds: duration ?? 5,
    kind: 'video',
    model: currentModel,
  });

  // img2vid / frame-conditioned generation — surface uploaders when
  // the model schema supports them. `imageUrl` = start frame,
  // `endImageUrl` = optional end frame.
  const supportsStartFrame = useVideoStore(
    videoGenerationConfigSelectors.isSupportedParam('imageUrl'),
  );
  const supportsEndFrame = useVideoStore(
    videoGenerationConfigSelectors.isSupportedParam('endImageUrl'),
  );

  const canGenerate = !isGenerating && promptValue.trim().length > 0;

  const handleGenerate = async () => {
    if (!canGenerate) return;
    // Mobile-only extra: close the create sheet so the user lands on
    // the gallery with the in-flight skeleton tile. The shared hook
    // handles tab switch + toast + createVideo.
    url.setView(undefined);
    await generate(promptValue);
    onAfterGenerate();
  };

  return (
    <Flexbox gap={12} style={{ paddingBlockEnd: 'env(safe-area-inset-bottom, 0)' }}>
      <PresetThumbCard preset={preset} onClear={clearPreset} />

      {/* Frame uploads — only rendered when the active video model
          schema declares support. Two slots side-by-side: start frame
          and (optional) end frame. */}
      {(supportsStartFrame || supportsEndFrame) && (
        <Flexbox horizontal gap={8}>
          {supportsStartFrame && (
            <Flexbox flex={1} gap={4}>
              <span style={{ color: 'var(--ant-color-text-tertiary)', fontSize: 11 }}>
                Стартовый кадр
              </span>
              <FrameUpload paramName="imageUrl" />
            </Flexbox>
          )}
          {supportsEndFrame && (
            <Flexbox flex={1} gap={4}>
              <span style={{ color: 'var(--ant-color-text-tertiary)', fontSize: 11 }}>
                Конечный кадр
              </span>
              <FrameUpload paramName="endImageUrl" />
            </Flexbox>
          )}
        </Flexbox>
      )}

      <PromptInput />

      <Flexbox gap={8}>
        <Flexbox gap={4}>
          <span style={{ color: 'var(--ant-color-text-tertiary)', fontSize: 11 }}>Модель</span>
          <ModelSelect />
        </Flexbox>

        <Flexbox gap={4}>
          <span style={{ color: 'var(--ant-color-text-tertiary)', fontSize: 11 }}>
            Соотношение сторон
          </span>
          <Segmented
            block
            options={ASPECT_OPTIONS}
            value={aspect ?? '16:9'}
            onChange={(v) => setParamOnInput('aspect_ratio' as any, v as any)}
          />
        </Flexbox>

        <Flexbox gap={4}>
          <span style={{ color: 'var(--ant-color-text-tertiary)', fontSize: 11 }}>
            Длительность
          </span>
          <Segmented
            block
            options={DURATION_OPTIONS}
            value={duration ?? 5}
            onChange={(v) => setParamOnInput('duration_sec' as any, v as any)}
          />
        </Flexbox>

        <button
          type="button"
          style={{
            alignItems: 'center',
            background: 'transparent',
            border: 0,
            color: 'var(--ant-color-link)',
            cursor: 'pointer',
            display: 'flex',
            fontSize: 13,
            gap: 6,
            padding: '4px 0',
          }}
          onClick={onOpenSettings}
        >
          <Settings size={14} />
          Дополнительные настройки
        </button>
      </Flexbox>

      <button
        disabled={!canGenerate}
        type="button"
        style={{
          alignItems: 'center',
          background: !canGenerate
            ? 'var(--ant-color-bg-text-hover)'
            : cost.credits != null && !cost.sufficient
              ? '#ff7875'
              : '#c4ff4d',
          border: 0,
          borderRadius: 12,
          color: canGenerate ? '#0a0a0a' : 'var(--ant-color-text-tertiary)',
          cursor: canGenerate ? 'pointer' : 'not-allowed',
          display: 'flex',
          fontSize: 16,
          fontWeight: 700,
          gap: 8,
          justifyContent: 'center',
          padding: '14px 16px',
        }}
        onClick={handleGenerate}
      >
        <Sparkles size={18} />
        {isGenerating ? 'Создаём…' : 'Создать'}
        {cost.credits != null && !isGenerating ? (
          <span style={{ fontWeight: 700, marginInlineStart: 2, opacity: 0.85 }}>
            · ~{cost.credits} кр
          </span>
        ) : null}
      </button>
    </Flexbox>
  );
});

MobileFlowContent.displayName = 'VideoMobileFlowContent';

export default MobileFlowContent;
