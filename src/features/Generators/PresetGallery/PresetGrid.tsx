'use client';

import { Empty, Spin } from 'antd';
import { memo } from 'react';

import { useIsMobile } from '@/hooks/useIsMobile';
import { lambdaQuery } from '@/libs/trpc/client';
import type { Preset, PresetModality } from '@/types/preset';

import PresetCard from '../PresetCard';

interface Props {
  category: string | undefined;
  modality: PresetModality;
  onSelect: (preset: Preset) => void;
  q: string | undefined;
  /** Filter by recommendedModelId — the "Model" tab in the gallery. */
  recommendedModelId: string | undefined;
  selectedSlug: string | null;
}

const PresetGrid = memo<Props>(
  ({ category, modality, recommendedModelId, onSelect, q, selectedSlug }) => {
    const isMobile = useIsMobile();
    const { data, isLoading } = lambdaQuery.presets.list.useQuery(
      { category, modality, q, recommendedModelId },
      { staleTime: 5 * 60 * 1000 },
    );

    if (isLoading) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
          <Spin />
        </div>
      );
    }

    if (!data || data.length === 0) {
      return <Empty description="Пресеты не найдены" style={{ paddingBlock: 64 }} />;
    }

    return (
      // CSS columns gives us a masonry-like layout: each card keeps
      // its own aspect ratio (portrait 3:4, landscape 16:9, square
      // 1:1, vertical 9:16 etc.) and the layout reflows around them.
      // A regular CSS grid would stretch everything to the same row
      // height and lose the visual variety the user asked for.
      <div
        style={{
          columnCount: isMobile ? 2 : 4,
          columnGap: 12,
          paddingInline: 16,
        }}
      >
        {data.map((p) => (
          <PresetCard
            isActive={p.slug === selectedSlug}
            key={p.slug}
            preset={p}
            onClick={onSelect}
          />
        ))}
      </div>
    );
  },
);

PresetGrid.displayName = 'PresetGrid';

export default PresetGrid;
