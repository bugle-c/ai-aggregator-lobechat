'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import FlowSidebar from '@/features/Generators/FlowSidebar';
import { useGenerationCostPreview } from '@/features/Generators/useGenerationCostPreview';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useImageStore } from '@/store/image';
import { imageGenerationConfigSelectors } from '@/store/image/slices/generationConfig/selectors';
import { presetSelectors } from '@/store/image/slices/preset/selectors';

import FlowMainArea from './features/FlowMainArea';
import FlowSidebarControls from './features/FlowSidebarControls';
import PromptInput from './features/PromptInput';
import ImageWorkspaceMobile from './ImageWorkspaceMobile';

const ImagePage = memo(() => {
  const isMobile = useIsMobile();

  const preset = useImageStore(presetSelectors.currentPreset);
  const clearPreset = useImageStore((s) => s.clearPreset);
  const isGenerating = useImageStore((s) => s.isCreating);
  const createImage = useImageStore((s) => s.createImage);
  const currentModel = useImageStore(imageGenerationConfigSelectors.model);
  const imageNum = useImageStore(imageGenerationConfigSelectors.imageNum);
  // Live cost preview drives the sidebar CTA label "Создать · ~128 кр" and
  // colours it red when the user can't afford the current params. Single
  // source of truth for the desktop button — PromptInput's Sparkles button
  // stays plain so there's only one place showing the price.
  const cost = useGenerationCostPreview({ images: imageNum, kind: 'image', model: currentModel });

  if (isMobile) return <ImageWorkspaceMobile />;

  return (
    <Flexbox horizontal flex={1} height={'100%'} width={'100%'}>
      <FlowSidebar
        controls={<FlowSidebarControls />}
        creditCost={cost.credits ?? undefined}
        creditSufficient={cost.sufficient}
        isGenerating={isGenerating}
        modality="image"
        preset={preset}
        promptInput={<PromptInput />}
        onClearPreset={clearPreset}
        onGenerate={() => createImage()}
      />
      <Flexbox flex={1} height={'100%'}>
        <FlowMainArea />
      </Flexbox>
    </Flexbox>
  );
});

ImagePage.displayName = 'ImagePage';

export default ImagePage;
