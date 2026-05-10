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
  modelId: string | undefined;
  onSelect: (preset: Preset) => void;
  q: string | undefined;
  selectedSlug: string | null;
}

const PresetGrid = memo<Props>(({ category, modality, modelId, onSelect, q, selectedSlug }) => {
  const isMobile = useIsMobile();
  const { data, isLoading } = lambdaQuery.presets.list.useQuery(
    { category, modality, modelId, q },
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
    <div
      style={{
        display: 'grid',
        gap: 12,
        gridTemplateColumns: isMobile
          ? 'repeat(2, minmax(0, 1fr))'
          : 'repeat(auto-fill, minmax(220px, 1fr))',
        paddingInline: 16,
      }}
    >
      {data.map((p) => (
        <PresetCard isActive={p.slug === selectedSlug} key={p.slug} preset={p} onClick={onSelect} />
      ))}
    </div>
  );
});

PresetGrid.displayName = 'PresetGrid';

export default PresetGrid;
