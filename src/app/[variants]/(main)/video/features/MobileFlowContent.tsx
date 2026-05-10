'use client';

import { Block, Flexbox } from '@lobehub/ui';
import { App } from 'antd';
import { Sparkles } from 'lucide-react';
import { memo } from 'react';

import PresetThumbCard from '@/features/Generators/PresetThumbCard';
import { useVideoStore } from '@/store/video';
import { videoGenerationConfigSelectors } from '@/store/video/selectors';
import { presetSelectors } from '@/store/video/slices/preset/selectors';

import PromptInput from './PromptInput';

const prettifyModelId = (modelId: string | undefined): string => {
  if (!modelId) return '—';
  const parts = modelId.split('/');
  const core = parts.length >= 2 ? parts[1] : parts[0];
  return core
    .split('-')
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
};

interface Props {
  onAfterGenerate: () => void;
  onOpenSettings: () => void;
}

/**
 * Higgsfield-style bottom-sheet content for /video on mobile.
 * Mirror of image equivalent + duration_sec chip.
 */
const MobileFlowContent = memo<Props>(({ onAfterGenerate, onOpenSettings }) => {
  const { message } = App.useApp();

  const preset = useVideoStore(presetSelectors.currentPreset);
  const clearPreset = useVideoStore((s) => s.clearPreset);
  const isGenerating = useVideoStore((s) => s.isCreating);
  const createVideo = useVideoStore((s) => s.createVideo);
  const model = useVideoStore(videoGenerationConfigSelectors.model);
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

      <Flexbox horizontal gap={8} style={{ flexWrap: 'wrap' }}>
        <Block clickable padding={'6px 12px'} variant="filled" onClick={onOpenSettings}>
          <span style={{ color: 'var(--ant-color-text-tertiary)', fontSize: 11 }}>Модель: </span>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{prettifyModelId(model)}</span>
        </Block>
        {aspect && (
          <Block clickable padding={'6px 12px'} variant="filled" onClick={onOpenSettings}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{aspect}</span>
          </Block>
        )}
        {duration != null && (
          <Block clickable padding={'6px 12px'} variant="filled" onClick={onOpenSettings}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{duration}s</span>
          </Block>
        )}
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
