'use client';

import { Block } from '@lobehub/ui';
import { memo } from 'react';

import type { Preset, PresetBadge } from '@/types/preset';

import PresetMP4Player from './PresetMP4Player';

interface Props {
  isActive?: boolean;
  onClick: (preset: Preset) => void;
  preset: Preset;
}

const BADGE_LABELS: Record<PresetBadge, string> = {
  mixed: 'Mixed',
  new: 'New',
  top_choice: 'Top',
  trending: '🔥',
};

const BADGE_COLORS: Record<PresetBadge, string> = {
  mixed: 'rgba(120, 120, 120, 0.85)',
  new: '#dc2626',
  top_choice: '#facc15',
  trending: 'transparent',
};

const PresetCard = memo<Props>(({ isActive, onClick, preset }) => {
  return (
    <Block
      clickable
      variant="filled"
      style={{
        aspectRatio: '3 / 4',
        border: isActive ? '2px solid var(--ant-color-primary)' : '1px solid transparent',
        borderRadius: 12,
        overflow: 'hidden',
        position: 'relative',
      }}
      onClick={() => onClick(preset)}
    >
      <PresetMP4Player ariaHidden fallbackLabel={preset.title} previewUrl={preset.previewUrl} />

      {preset.badges.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 4,
            insetBlockStart: 8,
            insetInlineStart: 8,
            position: 'absolute',
          }}
        >
          {preset.badges.map((b) => (
            <span
              key={b}
              style={{
                background: BADGE_COLORS[b],
                borderRadius: 6,
                color: b === 'top_choice' ? '#000' : '#fff',
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 6px',
              }}
            >
              {BADGE_LABELS[b]}
            </span>
          ))}
        </div>
      )}

      <div
        style={{
          background: 'linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.7) 100%)',
          color: '#fff',
          fontSize: 13,
          fontWeight: 600,
          insetBlockEnd: 0,
          insetInline: 0,
          padding: '24px 12px 10px',
          position: 'absolute',
          textTransform: 'uppercase',
        }}
      >
        {preset.title}
      </div>
    </Block>
  );
});

PresetCard.displayName = 'PresetCard';

export default PresetCard;
