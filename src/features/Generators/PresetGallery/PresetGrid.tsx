'use client';

import { Button, Empty, Spin } from 'antd';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsMobile } from '@/hooks/useIsMobile';
import { lambdaQuery } from '@/libs/trpc/client';
import type { PresetListItem, PresetModality, PresetSort } from '@/types/preset';

import PresetCard from '../PresetCard';

const PAGE_SIZE = 24;

interface Props {
  category: string | undefined;
  /** True when a category / model / search filter is narrowing the list. */
  hasFilters: boolean;
  modality: PresetModality;
  onResetFilters: () => void;
  onSelect: (preset: PresetListItem) => void;
  q: string | undefined;
  /** Filter by recommendedModelId — the "Model" tab in the gallery. */
  recommendedModelId: string | undefined;
  selectedSlug: string | null;
  sort?: PresetSort;
}

const PresetGrid = memo<Props>(
  ({
    category,
    hasFilters,
    modality,
    recommendedModelId,
    onResetFilters,
    onSelect,
    q,
    selectedSlug,
    sort,
  }) => {
    const isMobile = useIsMobile();
    const { t } = useTranslation('common');
    // Keyset pagination: the catalogue grows to ~1000 rows via the ingest
    // cron, so the gallery pulls a page at a time instead of the whole table.
    const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
      lambdaQuery.presets.list.useInfiniteQuery(
        { category, limit: PAGE_SIZE, modality, q, recommendedModelId, sort },
        {
          getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
          staleTime: 5 * 60 * 1000,
        },
      );

    const items = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);

    if (isLoading) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
          <Spin />
        </div>
      );
    }

    if (items.length === 0) {
      return (
        <Empty description={t('preset.empty')} style={{ paddingBlock: 64 }}>
          {/* Without this the user is stuck staring at an empty grid with no
              hint that a filter (possibly set on a previous visit, via the
              URL) is what is hiding everything. */}
          {hasFilters && <Button onClick={onResetFilters}>{t('preset.resetFilters')}</Button>}
        </Empty>
      );
    }

    return (
      <>
        {/* CSS columns gives us a masonry-like layout: each card keeps
            its own aspect ratio (portrait 3:4, landscape 16:9, square
            1:1, vertical 9:16 etc.) and the layout reflows around them.
            A regular CSS grid would stretch everything to the same row
            height and lose the visual variety the user asked for. */}
        <div
          style={{
            columnCount: isMobile ? 2 : 4,
            columnGap: 12,
            paddingInline: 16,
          }}
        >
          {items.map((p) => (
            <PresetCard
              isActive={p.slug === selectedSlug}
              key={p.slug}
              preset={p}
              onClick={onSelect}
            />
          ))}
        </div>
        {hasNextPage && (
          <div style={{ display: 'flex', justifyContent: 'center', paddingBlock: 16 }}>
            <Button loading={isFetchingNextPage} onClick={() => fetchNextPage()}>
              {t('preset.loadMore')}
            </Button>
          </div>
        )}
      </>
    );
  },
);

PresetGrid.displayName = 'PresetGrid';

export default PresetGrid;
