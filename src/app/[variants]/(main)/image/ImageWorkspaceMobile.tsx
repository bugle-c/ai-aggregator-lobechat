'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { Drawer } from 'antd';
import { ArrowLeft } from 'lucide-react';
import { memo, useState } from 'react';

import ConfigPanel from '@/app/[variants]/(main)/image/_layout/ConfigPanel';
import MobileFlowFAB from '@/features/Generators/MobileFlowFAB';
import MobileFlowSheet from '@/features/Generators/MobileFlowSheet';
import { useFlowUrlState } from '@/features/Generators/useFlowUrlState';
import MobileGlobalHeader from '@/features/MobileGlobalHeader';

import FlowMainArea from './features/FlowMainArea';
import MobileFlowContent from './features/MobileFlowContent';

/**
 * Mobile layout for `/image`.
 *
 * Two visual modes driven by `?view`:
 *   1. Default — preset gallery + FAB. User browses styles.
 *   2. `?view=create` — full-screen creation page (preset preview +
 *      prompt + chips + Generate). Mirrors higgsfield's
 *      gallery → /flow/<modality>/prompt navigation.
 *
 * When user taps a preset in the gallery, FlowMainArea calls
 * `setView('create')` which navigates to the creation page.
 * Back-arrow at the top returns to the gallery.
 */
const ImageWorkspaceMobile = memo(() => {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const url = useFlowUrlState('presets');

  // CREATION PAGE — full-screen, replaces gallery
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
        <Flexbox
          flex={1}
          padding={16}
          width={'100%'}
          style={{
            overflowY: 'auto',
            paddingBlockEnd: 'calc(env(safe-area-inset-bottom, 0px) + 80px)',
          }}
        >
          <MobileFlowContent
            onAfterGenerate={() => url.setView(undefined)}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </Flexbox>

        <Drawer
          destroyOnHidden={false}
          open={settingsOpen}
          placement="right"
          styles={{ body: { padding: 0 } }}
          title="Настройки"
          width={'90vw'}
          onClose={() => setSettingsOpen(false)}
        >
          <ConfigPanel />
        </Drawer>
      </>
    );
  }

  // GALLERY — default view, with FAB for users who want to skip preset
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

      <MobileFlowFAB hidden={sheetOpen} onClick={() => setSheetOpen(true)} />

      <MobileFlowSheet open={sheetOpen} onClose={() => setSheetOpen(false)}>
        <MobileFlowContent
          onAfterGenerate={() => setSheetOpen(false)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      </MobileFlowSheet>

      <Drawer
        destroyOnHidden={false}
        open={settingsOpen}
        placement="right"
        styles={{ body: { padding: 0 } }}
        title="Настройки"
        width={'90vw'}
        onClose={() => setSettingsOpen(false)}
      >
        <ConfigPanel />
      </Drawer>
    </>
  );
});

ImageWorkspaceMobile.displayName = 'ImageWorkspaceMobile';

export default ImageWorkspaceMobile;
