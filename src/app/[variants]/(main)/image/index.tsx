'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import FlowSidebar from '@/features/Generators/FlowSidebar';
import { useGenerationCostPreview } from '@/features/Generators/useGenerationCostPreview';
import { useImageGenerate } from '@/features/Generators/useImageGenerate';
import { useFetchAiImageConfig } from '@/hooks/useFetchAiImageConfig';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useImageStore } from '@/store/image';
import { imageGenerationConfigSelectors } from '@/store/image/slices/generationConfig/selectors';
import { presetSelectors } from '@/store/image/slices/preset/selectors';

import FlowMainArea from './features/FlowMainArea';
import FlowSidebarControls from './features/FlowSidebarControls';
import PresetPromptPreview from './features/PresetPromptPreview';
import PromptInput from './features/PromptInput';
import ImageWorkspaceMobile from './ImageWorkspaceMobile';

const ImagePage = memo(() => {
  const isMobile = useIsMobile();

  // Page-level config init — see video/index.tsx: running it lazily inside
  // the ⚙ panel reset the selected style's model and parameters.
  useFetchAiImageConfig();

  const preset = useImageStore(presetSelectors.currentPreset);
  const clearPreset = useImageStore((s) => s.clearPreset);
  const isGenerating = useImageStore((s) => s.isCreating);
  const currentModel = useImageStore(imageGenerationConfigSelectors.model);
  const imageNum = useImageStore(imageGenerationConfigSelectors.imageNum);
  // Read the live prompt for the generate hook — it does the Chinese-input
  // warning per current model + prompt content. Falls back to '' when the
  // textarea is empty (the hook's login check still runs).
  const parameters = useImageStore(imageGenerationConfigSelectors.parameters);
  const promptValue = (parameters?.prompt as string | undefined) ?? '';
  const generate = useImageGenerate();
  // Live cost preview drives the sidebar CTA label "Создать · ~128 кр" and
  // colours it red when the user can't afford the current params. Single
  // source of truth for the desktop button — PromptInput's Sparkles button
  // is gone, leaving only this CTA.
  const cost = useGenerationCostPreview({ images: imageNum, kind: 'image', model: currentModel });

  if (isMobile) return <ImageWorkspaceMobile />;

  return (
    <Flexbox horizontal flex={1} height={'100%'} width={'100%'}>
      <FlowSidebar
        creditCost={cost.credits ?? undefined}
        creditSufficient={cost.sufficient}
        isGenerating={isGenerating}
        preset={preset}
        promptInput={<PromptInput />}
        promptPreview={<PresetPromptPreview />}
        settings={<FlowSidebarControls />}
        onClearPreset={clearPreset}
        onGenerate={() => generate(promptValue)}
      />
      {/* min-width: 0 — see video/index.tsx: without it the column grows to the
          toolbar's min-content width and the masonry overflows the viewport. */}
      <Flexbox flex={1} height={'100%'} style={{ minWidth: 0 }}>
        <FlowMainArea />
      </Flexbox>
    </Flexbox>
  );
});

ImagePage.displayName = 'ImagePage';

export default ImagePage;
