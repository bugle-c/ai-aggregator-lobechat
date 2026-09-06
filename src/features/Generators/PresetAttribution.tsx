'use client';

import { memo } from 'react';

import type { PresetListItem } from '@/types/preset';

interface Props {
  /** Compact variant used inside the small selected-style card. */
  compact?: boolean;
  preset: PresetListItem;
}

const linkStyle = { color: 'inherit', textDecoration: 'underline' } as const;

/**
 * Author + source credit for an ingested preset.
 *
 * Presets ingested from third-party catalogues carry the original
 * author's name and a link to the source post; showing both is a legal
 * requirement of the ingest pipeline (see the preset-platform spec, Ф1).
 * Renders nothing for hand-curated presets, which have no attribution.
 */
const PresetAttribution = memo<Props>(({ compact, preset }) => {
  const { authorName, authorUrl, sourceUrl } = preset;
  if (!authorName && !sourceUrl) return null;

  return (
    <div
      style={{
        color: 'var(--ant-color-text-tertiary, rgba(0,0,0,0.45))',
        display: 'flex',
        flexWrap: 'wrap',
        fontSize: compact ? 11 : 12,
        gap: 8,
        lineHeight: 1.4,
      }}
    >
      {authorName &&
        (authorUrl ? (
          <a href={authorUrl} rel="noopener noreferrer nofollow" style={linkStyle} target="_blank">
            {authorName}
          </a>
        ) : (
          <span>{authorName}</span>
        ))}
      {sourceUrl && (
        <a href={sourceUrl} rel="noopener noreferrer nofollow" style={linkStyle} target="_blank">
          Источник ↗
        </a>
      )}
    </div>
  );
});

PresetAttribution.displayName = 'PresetAttribution';

export default PresetAttribution;
