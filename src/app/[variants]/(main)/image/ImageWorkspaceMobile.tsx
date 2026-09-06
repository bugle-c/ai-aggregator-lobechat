'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { ArrowLeft } from 'lucide-react';
import { memo } from 'react';

import MobileFlowFAB from '@/features/Generators/MobileFlowFAB';
import { useFlowUrlState } from '@/features/Generators/useFlowUrlState';
import MobileGlobalHeader from '@/features/MobileGlobalHeader';

import FlowMainArea from './features/FlowMainArea';
import MobileFlowContent from './features/MobileFlowContent';

/**
 * Mobile layout for `/image`.
 *
 * Two modes driven by `?view`:
 *   1. Default — preset gallery + FAB. User browses styles.
 *   2. `?view=create` — full-screen creation page (style card + prompt +
 *      settings strip + Generate).
 *
 * Tapping a gallery tile (FlowMainArea) and the FAB both go to `?view=create`
 * — one creation screen, with a URL and a back arrow, instead of the old
 * bottom sheet that had neither.
 */
const ImageWorkspaceMobile = memo(() => {
  const url = useFlowUrlState('presets');

  if (url.view === 'create') {
    return (
      <>
        {/* Custom header with back-arrow — MobileGlobalHeader's burger
            doesn't fit this context (creation page is a focused
            sub-flow, user wants to return to gallery, not open the
            global nav drawer). */}
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
          <span style={{ flex: 1, fontSize: 16, fontWeight: 600 }}>Создать изображение</span>
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
        <FlowMainArea />
      </Flexbox>

      <MobileFlowFAB onClick={() => url.setView('create')} />
    </>
  );
});

ImageWorkspaceMobile.displayName = 'ImageWorkspaceMobile';

export default ImageWorkspaceMobile;
