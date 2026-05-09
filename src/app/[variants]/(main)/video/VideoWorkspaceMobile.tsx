'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import NavHeader from '@/features/NavHeader';

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
      <NavHeader />
      <Flexbox flex={1} style={{ overflowY: 'auto', position: 'relative' }} width={'100%'}>
        <PlanGateBanner />
        <VideoWorkspace />
      </Flexbox>
    </>
  );
});

VideoWorkspaceMobile.displayName = 'VideoWorkspaceMobile';

export default VideoWorkspaceMobile;
