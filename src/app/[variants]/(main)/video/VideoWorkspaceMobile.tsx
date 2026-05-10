'use client';

import { Flexbox } from '@lobehub/ui';
import { Drawer } from 'antd';
import { memo, useState } from 'react';

import ConfigPanel from '@/app/[variants]/(main)/video/_layout/ConfigPanel';
import MobileFlowFAB from '@/features/Generators/MobileFlowFAB';
import MobileFlowSheet from '@/features/Generators/MobileFlowSheet';
import MobileGlobalHeader from '@/features/MobileGlobalHeader';

import FlowMainArea from './features/FlowMainArea';
import MobileFlowContent from './features/MobileFlowContent';
import PlanGateBanner from './features/PlanGateBanner';

/**
 * Mobile layout for `/video`: tabs Стили | Мои генерации with a
 * floating "Создать ✦" FAB that opens a bottom-sheet hosting the
 * higgsfield-style content. PlanGateBanner stays at top for free
 * users. Param chips open the settings drawer with full ConfigPanel.
 */
const VideoWorkspaceMobile = memo(() => {
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
        <PlanGateBanner />
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

VideoWorkspaceMobile.displayName = 'VideoWorkspaceMobile';

export default VideoWorkspaceMobile;
