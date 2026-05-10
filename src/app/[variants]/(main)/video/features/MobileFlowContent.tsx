'use client';

import { Flexbox } from '@lobehub/ui';
import { App, Segmented } from 'antd';
import { Settings, Sparkles } from 'lucide-react';
import { memo } from 'react';

import ModelSelect from '@/app/[variants]/(main)/video/_layout/ConfigPanel/components/ModelSelect';
import PresetThumbCard from '@/features/Generators/PresetThumbCard';
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
  const { message } = App.useApp();

  const preset = useVideoStore(presetSelectors.currentPreset);
  const clearPreset = useVideoStore((s) => s.clearPreset);
  const isGenerating = useVideoStore((s) => s.isCreating);
  const createVideo = useVideoStore((s) => s.createVideo);
  const setParamOnInput = useVideoStore((s) => s.setParamOnInput);
  const parameters = useVideoStore(videoGenerationConfigSelectors.parameters);
  const promptValue = (parameters?.prompt as string | undefined) ?? '';
  const aspect = (parameters?.aspect_ratio as string | undefined) ?? null;
  const duration = (parameters?.duration_sec as number | undefined) ?? null;

  const canGenerate = !isGenerating && promptValue.trim().length > 0;

  const handleGenerate = async () => {
    if (!canGenerate) return;
    try {
      await createVideo();
      onAfterGenerate();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Не удалось создать видео');
    }
  };

  return (
    <Flexbox gap={12} style={{ paddingBlockEnd: 'env(safe-area-inset-bottom, 0)' }}>
      <PresetThumbCard preset={preset} onClear={clearPreset} />

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
          background: canGenerate ? '#c4ff4d' : 'var(--ant-color-bg-text-hover)',
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
      </button>
    </Flexbox>
  );
});

MobileFlowContent.displayName = 'VideoMobileFlowContent';

export default MobileFlowContent;
