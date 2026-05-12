'use client';

import { Flexbox } from '@lobehub/ui';
import { App, Segmented } from 'antd';
import { Settings, Sparkles } from 'lucide-react';
import { memo } from 'react';

import ImageUrl from '@/app/[variants]/(main)/image/_layout/ConfigPanel/components/ImageUrl';
import ImageUrlsUpload from '@/app/[variants]/(main)/image/_layout/ConfigPanel/components/ImageUrlsUpload';
import ModelSelect from '@/app/[variants]/(main)/image/_layout/ConfigPanel/components/ModelSelect';
import PresetThumbCard from '@/features/Generators/PresetThumbCard';
import { useFlowUrlState } from '@/features/Generators/useFlowUrlState';
import { useImageStore } from '@/store/image';
import { imageGenerationConfigSelectors } from '@/store/image/selectors';
import { presetSelectors } from '@/store/image/slices/preset/selectors';

import PromptInput from './PromptInput';

const ASPECT_OPTIONS = ['1:1', '16:9', '9:16', '4:3', '3:4'];

interface Props {
  onAfterGenerate: () => void;
  onOpenSettings: () => void;
}

/**
 * Higgsfield-style mobile creation surface:
 *   1. Preset preview card (or empty placeholder)
 *   2. Prompt input (with its embedded toolbar + sparkles button)
 *   3. Inline settings: Model picker + Aspect ratio segmented
 *   4. "Доп. настройки" link that opens the full ConfigPanel drawer
 *      (seed / steps / cfg / image upload — power-user knobs)
 *   5. Big yellow Generate button (disabled when prompt empty)
 */
const MobileFlowContent = memo<Props>(({ onAfterGenerate, onOpenSettings }) => {
  const { message } = App.useApp();
  const url = useFlowUrlState('presets');

  const preset = useImageStore(presetSelectors.currentPreset);
  const clearPreset = useImageStore((s) => s.clearPreset);
  const isGenerating = useImageStore((s) => s.isCreating);
  const createImage = useImageStore((s) => s.createImage);
  const setParamOnInput = useImageStore((s) => s.setParamOnInput);
  const parameters = useImageStore(imageGenerationConfigSelectors.parameters);
  const promptValue = (parameters?.prompt as string | undefined) ?? '';
  const aspect = (parameters?.aspect_ratio as string | undefined) ?? null;

  // The selected model may support a single reference image (img2img,
  // FLUX Kontext etc.) and/or multiple reference images. Surface these
  // uploaders inline when the model schema lists them — otherwise hide.
  const supportsImageUrl = useImageStore(
    imageGenerationConfigSelectors.isSupportedParam('imageUrl'),
  );
  const supportsImageUrls = useImageStore(
    imageGenerationConfigSelectors.isSupportedParam('imageUrls'),
  );

  const canGenerate = !isGenerating && promptValue.trim().length > 0;

  const handleGenerate = async () => {
    if (!canGenerate) return;
    try {
      // Switch to feed + close the create sheet so the user sees the
      // embedded ResourceExplorer with their previous gens and the
      // skeleton tile for the in-flight one.
      url.setTab('feed');
      url.setView(undefined);
      message.success({ content: 'Генерация запущена', duration: 1.5 });
      void createImage();
      onAfterGenerate();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Не удалось создать изображение');
    }
  };

  return (
    <Flexbox gap={12} style={{ paddingBlockEnd: 'env(safe-area-inset-bottom, 0)' }}>
      <PresetThumbCard preset={preset} onClear={clearPreset} />

      {/* Reference image upload — visible only when the active model
          schema declares support. Two distinct slots: single ref image
          (img2img / FLUX Kontext-style) vs multi-image input. */}
      {supportsImageUrl && (
        <Flexbox gap={4}>
          <span style={{ color: 'var(--ant-color-text-tertiary)', fontSize: 11 }}>
            Референсное изображение
          </span>
          <ImageUrl />
        </Flexbox>
      )}
      {supportsImageUrls && (
        <Flexbox gap={4}>
          <span style={{ color: 'var(--ant-color-text-tertiary)', fontSize: 11 }}>
            Референсные изображения
          </span>
          <ImageUrlsUpload />
        </Flexbox>
      )}

      <PromptInput />

      {/* Inline settings — visible at all times so the user knows
          they can tweak model + aspect right here. Power-user knobs
          (seed, steps, cfg, image upload) live behind "Доп. настройки". */}
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
            // Pass through to existing param setter so upstream
            // generation logic and Drizzle-validated config stay
            // unchanged. `as any` because the param key is loose.
            value={aspect ?? '1:1'}
            onChange={(v) => setParamOnInput('aspect_ratio' as any, v as any)}
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

MobileFlowContent.displayName = 'ImageMobileFlowContent';

export default MobileFlowContent;
