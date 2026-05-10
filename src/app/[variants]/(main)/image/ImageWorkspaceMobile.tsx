'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import MobileGlobalHeader from '@/features/MobileGlobalHeader';

import ImageWorkspace from './features/ImageWorkspace';

/**
 * Mobile layout for `/image`. The shared `ImageWorkspace` already renders
 * as a stacked feed + sticky prompt input, so the only thing the mobile
 * wrapper needs to do is drop the `WideScreenContainer` width clamp (which
 * is wrong at 375px) and the `WideScreenButton` toggle (only meaningful on
 * desktop). Header right-slot stays empty on mobile.
 */
const ImageWorkspaceMobile = memo(() => {
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
        <ImageWorkspace />
      </Flexbox>
    </>
  );
});

ImageWorkspaceMobile.displayName = 'ImageWorkspaceMobile';

export default ImageWorkspaceMobile;
