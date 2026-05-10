'use client';

import { Flexbox } from '@lobehub/ui';
import { Drawer } from 'antd';
import { memo, useState } from 'react';

import ConfigPanel from '@/app/[variants]/(main)/image/_layout/ConfigPanel';
import MobileFlowFAB from '@/features/Generators/MobileFlowFAB';
import MobileFlowSheet from '@/features/Generators/MobileFlowSheet';
import MobileGlobalHeader from '@/features/MobileGlobalHeader';

import FlowMainArea from './features/FlowMainArea';
import MobileFlowContent from './features/MobileFlowContent';

/**
 * Mobile layout for `/image`: tabs Стили | Мои генерации with a
 * floating "Создать ✦" FAB that opens a bottom-sheet hosting the
 * higgsfield-style content (preset preview + prompt + chips +
 * yellow Generate). Param chips open the settings drawer.
 */
const ImageWorkspaceMobile = memo(() => {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

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

      {/* Settings drawer slides from right; opens when the user taps a
          chip (Модель / aspect) inside the flow sheet. Reuses the
          existing ConfigPanel for full param control. */}
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
