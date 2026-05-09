'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import WideScreenButton from '@/features/WideScreenContainer/WideScreenButton';
import { useIsMobile } from '@/hooks/useIsMobile';

import VideoWorkspaceMobile from './VideoWorkspaceMobile';
import PlanGateBanner from './features/PlanGateBanner';
import VideoWorkspace from './features/VideoWorkspace';

const VideoPage = memo(() => {
  const isMobile = useIsMobile();
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
});

VideoPage.displayName = 'VideoPage';

export default VideoPage;
