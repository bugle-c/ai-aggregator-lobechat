'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import MobileGlobalHeader from '@/features/MobileGlobalHeader';

import PlanGateBanner from './features/PlanGateBanner';
import VideoWorkspace from './features/VideoWorkspace';

/**
 * Mobile layout for `/video`. Mirrors `ImageWorkspaceMobile`: drops the
 * `WideScreenContainer` clamp + `WideScreenButton` so the workspace fills
 * the viewport. `PlanGateBanner` (free-user upsell at the top) is kept —
 * mobile is exactly the surface where this matters most.
 */
const VideoWorkspaceMobile = memo(() => {
  return (
    <>
      <MobileGlobalHeader />
      <Flexbox
        flex={1}
        width={'100%'}
        style={{
          overflowY: 'auto',
          paddingBlockEnd: 'calc(env(safe-area-inset-bottom, 0px) + 80px)',
          position: 'relative',
        }}
      >
        <PlanGateBanner />
        <VideoWorkspace />
      </Flexbox>
    </>
  );
});

VideoWorkspaceMobile.displayName = 'VideoWorkspaceMobile';

export default VideoWorkspaceMobile;
