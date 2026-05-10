'use client';

import { Block, Flexbox } from '@lobehub/ui';
import { App } from 'antd';
import { Sparkles } from 'lucide-react';
import { memo } from 'react';

import PresetThumbCard from '@/features/Generators/PresetThumbCard';
import { useImageStore } from '@/store/image';
import { imageGenerationConfigSelectors } from '@/store/image/selectors';
import { presetSelectors } from '@/store/image/slices/preset/selectors';

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
 * Higgsfield-style bottom-sheet content for /image on mobile:
 *   1. Preset preview card (or empty placeholder)
 *   2. Prompt input (with its embedded toolbar + sparkles button)
 *   3. Quick chips row: model · aspect ratio (open settings on tap)
 *   4. Big yellow Generate button (disabled when prompt empty)
 */
const MobileFlowContent = memo<Props>(({ onAfterGenerate, onOpenSettings }) => {
  const { message } = App.useApp();

  const preset = useImageStore(presetSelectors.currentPreset);
  const clearPreset = useImageStore((s) => s.clearPreset);
  const isGenerating = useImageStore((s) => s.isCreating);
  const createImage = useImageStore((s) => s.createImage);
  const model = useImageStore(imageGenerationConfigSelectors.model);
  const parameters = useImageStore(imageGenerationConfigSelectors.parameters);
  const promptValue = (parameters?.prompt as string | undefined) ?? '';
  const aspect = (parameters?.aspect_ratio as string | undefined) ?? null;

  const canGenerate = !isGenerating && promptValue.trim().length > 0;

  const handleGenerate = async () => {
    if (!canGenerate) return;
    try {
      await createImage();
      onAfterGenerate();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Не удалось создать изображение');
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

MobileFlowContent.displayName = 'ImageMobileFlowContent';

export default MobileFlowContent;
