'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import MobileFlowFAB from '@/features/Generators/MobileFlowFAB';
import MobileFlowSheet from '@/features/Generators/MobileFlowSheet';
import MobileGlobalHeader from '@/features/MobileGlobalHeader';
import { useImageStore } from '@/store/image';
import { presetSelectors } from '@/store/image/slices/preset/selectors';

import FlowMainArea from './features/FlowMainArea';
import ImageWorkspace from './features/ImageWorkspace';
import PromptInput from './features/PromptInput';

/**
 * Mobile layout for `/image`. Behind `?new_flow=1`: tabbed
 * Стили/Мои генерации with a floating FAB that opens a bottom-sheet
 * containing the prompt + Generate button. Without the flag: legacy
 * stacked feed (unchanged).
 */
const ImageWorkspaceMobile = memo(() => {
  const [params] = useSearchParams();
  const newFlow = params.get('new_flow') === '1';
  const [sheetOpen, setSheetOpen] = useState(false);

  const preset = useImageStore(presetSelectors.currentPreset);
  const clearPreset = useImageStore((s) => s.clearPreset);
  const isGenerating = useImageStore((s) => s.isCreating);
  const createImage = useImageStore((s) => s.createImage);

  const containerStyle = {
    overflowY: 'auto' as const,
    paddingBlockEnd: 'calc(env(safe-area-inset-bottom, 0px) + 80px)',
    position: 'relative' as const,
  };

  if (!newFlow) {
    return (
      <>
        <MobileGlobalHeader />
        <Flexbox flex={1} style={containerStyle} width={'100%'}>
          <ImageWorkspace />
        </Flexbox>
      </>
    );
  }

  return (
    <>
      <MobileGlobalHeader />
      <Flexbox flex={1} style={containerStyle} width={'100%'}>
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
