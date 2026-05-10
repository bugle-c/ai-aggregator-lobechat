'use client';

import { Block, Flexbox } from '@lobehub/ui';
import { Drawer } from 'antd';
import { Settings } from 'lucide-react';
import { memo, useState } from 'react';

import ConfigPanel from '@/app/[variants]/(main)/video/_layout/ConfigPanel';
import { useVideoStore } from '@/store/video';
import { videoGenerationConfigSelectors } from '@/store/video/selectors';

/**
 * Compact controls for the desktop FlowSidebar (video).
 * Mirror of image/FlowSidebarControls — reuses the existing video
 * ConfigPanel (model select, FrameUpload for img2vid, aspect ratio,
 * duration, seed, ...) inside a right-side drawer.
 */
const prettify = (modelId: string | undefined): string => {
  if (!modelId) return 'Не выбрано';
  const parts = modelId.split('/');
  const core = parts.length >= 2 ? parts[1] : parts[0];
  return core
    .split('-')
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
};

const FlowSidebarControls = memo(() => {
  const [open, setOpen] = useState(false);
  const model = useVideoStore(videoGenerationConfigSelectors.model);

  return (
    <>
      <Block clickable padding={10} variant="filled" onClick={() => setOpen(true)}>
        <Flexbox horizontal align="center" gap={8} justify="space-between">
          <Flexbox>
            <span style={{ color: 'var(--ant-color-text-tertiary)', fontSize: 11 }}>Модель</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{prettify(model)}</span>
          </Flexbox>
          <Settings size={18} style={{ color: 'var(--ant-color-text-secondary)' }} />
        </Flexbox>
      </Block>

      <Drawer
        destroyOnHidden={false}
        open={open}
        placement="right"
        styles={{ body: { padding: 0 } }}
        title="Настройки генерации"
        width={360}
        onClose={() => setOpen(false)}
      >
        <ConfigPanel />
      </Drawer>
    </>
  );
});

FlowSidebarControls.displayName = 'VideoFlowSidebarControls';

export default FlowSidebarControls;
