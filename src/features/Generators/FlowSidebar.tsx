'use client';

import { Flexbox } from '@lobehub/ui';
import { Button } from 'antd';
import { memo, type ReactNode } from 'react';

import type { Preset, PresetModality } from '@/types/preset';

import PresetThumbCard from './PresetThumbCard';

interface Props {
  /** Whatever extra widgets the modality wants — image-upload, settings ⚙, model selector. */
  controls: ReactNode;
  creditCost?: number;
  generateLabel?: string;
  isGenerating: boolean;
  modality: PresetModality;
  onClearPreset: () => void;
  onGenerate: () => void;
  preset: Preset | null;
  /** PromptInput component instance — modality-specific so we keep this pluggable. */
  promptInput: ReactNode;
}

/**
 * Desktop persistent sidebar (~320px).
 * Layout from top to bottom:
 *   1. PresetThumbCard (selected style or empty placeholder)
 *   2. Modality-specific controls (image upload, model selector, etc.)
 *   3. PromptInput (textarea + enhance toggle)
 *   4. Generate button with credit cost
 */
const FlowSidebar = memo<Props>(
  ({
    controls,
    creditCost,
    generateLabel,
    isGenerating,
    modality,
    onClearPreset,
    onGenerate,
    preset,
    promptInput,
  }) => {
    const label = generateLabel ?? (modality === 'video' ? 'Создать видео' : 'Создать');

    return (
      <Flexbox
        gap={12}
        height={'100%'}
        padding={16}
        style={{
          background: 'var(--ant-color-bg-layout)',
          borderInlineEnd: '1px solid var(--ant-color-border-secondary)',
          inlineSize: 320,
          minInlineSize: 320,
        }}
      >
        <PresetThumbCard preset={preset} onClear={onClearPreset} />
        {controls}
        {promptInput}
        <Button
          block
          loading={isGenerating}
          size="large"
          style={{ marginBlockStart: 'auto' }}
          type="primary"
          onClick={onGenerate}
        >
          {label}
          {creditCost !== undefined && (
            <span style={{ marginInlineStart: 6, opacity: 0.85 }}>✦ {creditCost}</span>
          )}
        </Button>
      </Flexbox>
    );
  },
);

FlowSidebar.displayName = 'FlowSidebar';

export default FlowSidebar;
