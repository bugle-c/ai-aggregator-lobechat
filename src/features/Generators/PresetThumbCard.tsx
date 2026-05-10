'use client';

import { Block, Flexbox } from '@lobehub/ui';
import { Sparkles, X } from 'lucide-react';
import { memo } from 'react';

import type { Preset } from '@/types/preset';

import PresetMP4Player from './PresetMP4Player';

interface Props {
  onClear: () => void;
  preset: Preset | null;
}

const PresetThumbCard = memo<Props>(({ onClear, preset }) => {
  if (!preset) {
    return (
      <Block
        padding={16}
        variant="outlined"
        style={{
          alignItems: 'center',
          borderStyle: 'dashed',
          color: 'var(--ant-color-text-tertiary)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          textAlign: 'center',
        }}
      >
        <Sparkles size={20} />
        <span style={{ fontSize: 13 }}>Выберите стиль или начните с чистого листа</span>
      </Block>
    );
  }

  return (
    <Block padding={0} style={{ overflow: 'hidden', position: 'relative' }} variant="filled">
      <div style={{ aspectRatio: '4 / 3' }}>
        <PresetMP4Player previewUrl={preset.previewUrl} />
      </div>
      <Flexbox horizontal align="center" justify="space-between" padding={8}>
        <Flexbox>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{preset.title}</span>
          <span style={{ color: 'var(--ant-color-text-secondary)', fontSize: 11 }}>
            {preset.modelId}
          </span>
        </Flexbox>
        <button
          aria-label="Снять стиль"
          type="button"
          style={{
            background: 'transparent',
            border: 0,
            color: 'var(--ant-color-text-secondary)',
            cursor: 'pointer',
            padding: 4,
          }}
          onClick={onClear}
        >
          <X size={16} />
        </button>
      </Flexbox>
    </Block>
  );
});

PresetThumbCard.displayName = 'PresetThumbCard';

export default PresetThumbCard;
