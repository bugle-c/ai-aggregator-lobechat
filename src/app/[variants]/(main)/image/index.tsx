'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useSearchParams } from 'react-router-dom';

import FlowSidebar from '@/features/Generators/FlowSidebar';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import WideScreenButton from '@/features/WideScreenContainer/WideScreenButton';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useImageStore } from '@/store/image';
import { presetSelectors } from '@/store/image/slices/preset/selectors';

import FlowMainArea from './features/FlowMainArea';
import ImageWorkspace from './features/ImageWorkspace';
import PromptInput from './features/PromptInput';
import ImageWorkspaceMobile from './ImageWorkspaceMobile';

const ImagePage = memo(() => {
  const [params] = useSearchParams();
  const newFlow = params.get('new_flow') === '1';
  const isMobile = useIsMobile();

  const preset = useImageStore(presetSelectors.currentPreset);
  const clearPreset = useImageStore((s) => s.clearPreset);
  const isGenerating = useImageStore((s) => s.isCreating);
  const createImage = useImageStore((s) => s.createImage);

  if (!newFlow) {
    if (isMobile) return <ImageWorkspaceMobile />;
    return (
      <>
        <NavHeader right={<WideScreenButton />} />
        <Flexbox height={'100%'} style={{ overflowY: 'auto', position: 'relative' }} width={'100%'}>
          <WideScreenContainer height={'100%'} wrapperStyle={{ height: '100%' }}>
            <ImageWorkspace />
          </WideScreenContainer>
        </Flexbox>
      </>
    );
  }

  // Mobile wiring of the new flow lives in ImageWorkspaceMobile (Task 21).
  if (isMobile) return <ImageWorkspaceMobile />;

  return (
    <Flexbox horizontal flex={1} height={'100%'} width={'100%'}>
      <FlowSidebar
        controls={null}
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
