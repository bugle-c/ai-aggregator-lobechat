'use client';

import { Flexbox } from '@lobehub/ui';
import { Button } from 'antd';
import { Sparkles } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import ImageUrl from '@/app/[variants]/(main)/image/_layout/ConfigPanel/components/ImageUrl';
import ImageUrlsUpload from '@/app/[variants]/(main)/image/_layout/ConfigPanel/components/ImageUrlsUpload';
import PresetThumbCard from '@/features/Generators/PresetThumbCard';
import { useFlowUrlState } from '@/features/Generators/useFlowUrlState';
import { useGenerationCostPreview } from '@/features/Generators/useGenerationCostPreview';
import { useImageGenerate } from '@/features/Generators/useImageGenerate';
import { useImageStore } from '@/store/image';
import { imageGenerationConfigSelectors } from '@/store/image/selectors';
import { presetSelectors } from '@/store/image/slices/preset/selectors';

import FlowSidebarControls from './FlowSidebarControls';
import PresetPromptPreview from './PresetPromptPreview';
import PromptInput from './PromptInput';

interface Props {
  onAfterGenerate: () => void;
}

/**
 * Mobile creation screen (`?view=create`), top to bottom:
 *   1. PresetThumbCard — selected style, «Подробнее» / «Убрать»
 *   2. Reference-image uploaders, when the model schema lists them
 *   3. PresetPromptPreview — what the style will actually send
 *   4. SettingsStrip — model / aspect / count / cost / ⚙, right above the words
 *   5. PromptInput — optional when a style is selected
 *   6. Sticky «Сгенерировать · ≈ N кр», 48px, above the safe area
 */
const MobileFlowContent = memo<Props>(({ onAfterGenerate }) => {
  const { t } = useTranslation('common');
  const url = useFlowUrlState('presets');

  const preset = useImageStore(presetSelectors.currentPreset);
  const clearPreset = useImageStore((s) => s.clearPreset);
  const isGenerating = useImageStore((s) => s.isCreating);
  const parameters = useImageStore(imageGenerationConfigSelectors.parameters);
  const promptValue = (parameters?.prompt as string | undefined) ?? '';
  const currentModel = useImageStore(imageGenerationConfigSelectors.model);
  const imageNum = useImageStore(imageGenerationConfigSelectors.imageNum);
  const cost = useGenerationCostPreview({ images: imageNum, kind: 'image', model: currentModel });
  const generate = useImageGenerate();

  // The selected model may support a single reference image (img2img,
  // FLUX Kontext etc.) and/or multiple reference images. Surface these
  // uploaders inline when the model schema lists them — otherwise hide.
  const supportsImageUrl = useImageStore(
    imageGenerationConfigSelectors.isSupportedParam('imageUrl'),
  );
  const supportsImageUrls = useImageStore(
    imageGenerationConfigSelectors.isSupportedParam('imageUrls'),
  );

  // A preset is a ready prompt: with one selected, an empty input is a
  // valid one-tap run (`applyPresetTemplate('', tpl)` → `tpl`).
  const canGenerate = !isGenerating && (promptValue.trim().length > 0 || !!preset?.promptTemplate);
  const insufficient = cost.credits !== null && !cost.sufficient;

  const handleGenerate = async () => {
    if (!canGenerate) return;
    // The hook handles tab switch + toast + Chinese warning + createImage.
    // Mobile-only extra: leave the create screen so the user lands on the
    // gallery with the in-flight skeleton tile.
    url.setView(undefined);
    await generate(promptValue);
    onAfterGenerate();
  };

  return (
    <Flexbox gap={12} style={{ minBlockSize: '100%' }}>
      <PresetThumbCard preset={preset} onClear={clearPreset} />

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

      <PresetPromptPreview />

      <FlowSidebarControls />

      <PromptInput />

      {/* Sticky inside the scroll container so it survives a long prompt
          preview and the keyboard; padded above the home indicator. */}
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
            : cost.credits === null
              ? t('preset.generate')
              : `${t('preset.generate')} · ${t('preset.credits', { count: cost.credits })}`}
        </Button>
      </div>
    </Flexbox>
  );
});

MobileFlowContent.displayName = 'ImageMobileFlowContent';

export default MobileFlowContent;
