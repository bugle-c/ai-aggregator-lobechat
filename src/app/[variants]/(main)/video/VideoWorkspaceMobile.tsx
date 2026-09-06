'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { ArrowLeft } from 'lucide-react';
import { memo } from 'react';

import MobileFlowFAB from '@/features/Generators/MobileFlowFAB';
import { useFlowUrlState } from '@/features/Generators/useFlowUrlState';
import MobileGlobalHeader from '@/features/MobileGlobalHeader';

import FlowMainArea from './features/FlowMainArea';
import MobileFlowContent from './features/MobileFlowContent';
import PlanGateBanner from './features/PlanGateBanner';

/**
 * Mobile layout for `/video`.
 * Mirror of ImageWorkspaceMobile — same two-mode pattern (gallery
 * default / `?view=create` full-screen). PlanGateBanner stays at top
 * of gallery for free users.
 */
const VideoWorkspaceMobile = memo(() => {
  const url = useFlowUrlState('presets');

  if (url.view === 'create') {
    return (
      <>
        <Flexbox
          horizontal
          align="center"
          gap={12}
          paddingInline={12}
          style={{
            background: 'var(--ant-color-bg-container)',
            borderBlockEnd: '1px solid var(--ant-color-border-secondary)',
            flex: '0 0 auto',
            height: 56,
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}
        >
          <ActionIcon
            aria-label="Назад"
            icon={ArrowLeft}
            size="large"
            onClick={() => url.setView(undefined)}
          />
          <span style={{ flex: 1, fontSize: 16, fontWeight: 600 }}>Создать видео</span>
        </Flexbox>
        <Flexbox flex={1} padding={16} style={{ overflowY: 'auto' }} width={'100%'}>
          <MobileFlowContent onAfterGenerate={() => url.setView(undefined)} />
        </Flexbox>
      </>
    );
  }

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
        <FlowMainArea />
      </Flexbox>

      <MobileFlowFAB onClick={() => url.setView('create')} />
    </>
  );
});

VideoWorkspaceMobile.displayName = 'VideoWorkspaceMobile';

export default VideoWorkspaceMobile;
