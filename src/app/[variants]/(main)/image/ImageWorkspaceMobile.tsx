'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useState } from 'react';

import MobileFlowFAB from '@/features/Generators/MobileFlowFAB';
import MobileFlowSheet from '@/features/Generators/MobileFlowSheet';
import MobileGlobalHeader from '@/features/MobileGlobalHeader';
import { useImageStore } from '@/store/image';
import { presetSelectors } from '@/store/image/slices/preset/selectors';

import FlowMainArea from './features/FlowMainArea';
import PromptInput from './features/PromptInput';

/**
 * Mobile layout for `/image`: tabs Стили | Мои генерации with a
 * floating "Создать ✦" FAB that opens a bottom-sheet containing the
 * prompt + Generate button.
 */
const ImageWorkspaceMobile = memo(() => {
  const [sheetOpen, setSheetOpen] = useState(false);

  const preset = useImageStore(presetSelectors.currentPreset);
  const clearPreset = useImageStore((s) => s.clearPreset);
  const isGenerating = useImageStore((s) => s.isCreating);
  const createImage = useImageStore((s) => s.createImage);

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
        <Flexbox gap={12}>
          {preset ? (
            <button
              type="button"
              style={{
                background: 'transparent',
                border: 0,
                color: 'var(--ant-color-text)',
                cursor: 'pointer',
                font: 'inherit',
                textAlign: 'start',
              }}
              onClick={clearPreset}
            >
              <strong>Стиль:</strong> {preset.title} · ✕
            </button>
          ) : (
            <span style={{ color: 'var(--ant-color-text-tertiary)' }}>Стиль не выбран</span>
          )}

          <PromptInput />

          <button
            disabled={isGenerating}
            type="button"
            style={{
              background: 'var(--ant-color-primary)',
              border: 0,
              borderRadius: 8,
              color: '#fff',
              cursor: 'pointer',
              fontSize: 16,
              fontWeight: 600,
              padding: '14px 16px',
            }}
            onClick={async () => {
              await createImage();
              setSheetOpen(false);
            }}
          >
            {isGenerating ? 'Создаём…' : 'Создать'}
          </button>
        </Flexbox>
      </MobileFlowSheet>
    </>
  );
});

ImageWorkspaceMobile.displayName = 'ImageWorkspaceMobile';

export default ImageWorkspaceMobile;
