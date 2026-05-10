'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useSearchParams } from 'react-router-dom';

import FlowSidebar from '@/features/Generators/FlowSidebar';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import WideScreenButton from '@/features/WideScreenContainer/WideScreenButton';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useVideoStore } from '@/store/video';
import { presetSelectors } from '@/store/video/slices/preset/selectors';

import FlowMainArea from './features/FlowMainArea';
import FlowSidebarControls from './features/FlowSidebarControls';
import PlanGateBanner from './features/PlanGateBanner';
import PromptInput from './features/PromptInput';
import VideoWorkspace from './features/VideoWorkspace';
import VideoWorkspaceMobile from './VideoWorkspaceMobile';

const VideoPage = memo(() => {
  const [params] = useSearchParams();
  const newFlow = params.get('new_flow') === '1';
  const isMobile = useIsMobile();

  const preset = useVideoStore(presetSelectors.currentPreset);
  const clearPreset = useVideoStore((s) => s.clearPreset);
  const isGenerating = useVideoStore((s) => s.isCreating);
  const createVideo = useVideoStore((s) => s.createVideo);

  if (!newFlow) {
    if (isMobile) return <VideoWorkspaceMobile />;
    return (
      <>
        <NavHeader right={<WideScreenButton />} />
        <Flexbox height={'100%'} style={{ overflowY: 'auto', position: 'relative' }} width={'100%'}>
          <PlanGateBanner />
          <WideScreenContainer height={'100%'} wrapperStyle={{ height: '100%' }}>
            <VideoWorkspace />
          </WideScreenContainer>
        </Flexbox>
      </>
    );
  }

  if (isMobile) return <VideoWorkspaceMobile />;

  return (
    <Flexbox horizontal flex={1} height={'100%'} width={'100%'}>
      <FlowSidebar
        controls={<FlowSidebarControls />}
        isGenerating={isGenerating}
        modality="video"
        preset={preset}
        promptInput={<PromptInput />}
        onClearPreset={clearPreset}
        onGenerate={() => createVideo()}
      />
      <Flexbox flex={1} height={'100%'}>
        <PlanGateBanner />
        <FlowMainArea />
      </Flexbox>
    </Flexbox>
  );
});

VideoPage.displayName = 'VideoPage';

export default VideoPage;
