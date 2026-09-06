'use client';

import { useLatest } from 'ahooks';
import { Button, Empty, Spin } from 'antd';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsMobile } from '@/hooks/useIsMobile';
import { lambdaQuery } from '@/libs/trpc/client';
import type { PresetListItem, PresetModality, PresetSort } from '@/types/preset';

import PresetCard from '../PresetCard';
import PresetZoomModal from '../PresetZoomModal';

const PAGE_SIZE = 24;

/**
 * How far below the fold the sentinel starts pulling the next page. One
 * viewport of lead time hides the request latency on a throttled connection
 * without pre-fetching pages the user will never scroll to.
 */
const PREFETCH_MARGIN = '600px 0px';

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

    // One modal for the whole list. It used to be one per card, so a fully
    // scrolled 1000-row gallery mounted 1000 antd dialogs.
    const [zoomPreset, setZoomPreset] = useState<PresetListItem | null>(null);

    const sentinelRef = useRef<HTMLDivElement | null>(null);
    const pageCount = data?.pages.length ?? 0;
    const loadMore = useLatest(() => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    });

    useEffect(() => {
      const el = sentinelRef.current;
      if (!el || !hasNextPage) return;

      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) loadMore.current();
        },
        { rootMargin: PREFETCH_MARGIN },
      );
      io.observe(el);
      return () => io.disconnect();
      // `pageCount` is a dependency on purpose: an IntersectionObserver only
      // fires on a *change* in intersection, so if the sentinel is still on
      // screen after a page lands it would never fire again. Re-creating the
      // observer re-reports the current state and the scroll keeps going.
    }, [hasNextPage, pageCount, loadMore]);

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
        {/* A real grid, not CSS multi-column. Multicol balances column
            heights, so it fills column 1 top-to-bottom before column 2:
            with a ranked 1000-row list the first screen showed ranks 1,
            251, 501 and 751 side by side and the curation order was
            unreadable. Grid keeps reading order left→right, top→bottom.
            Mobile is pinned to 2 columns so a card stays ~140px wide and
            its Russian caption remains legible; desktop auto-fills so wide
            screens show more of the ranking instead of four huge cards. */}
        <div
          style={{
            display: 'grid',
            gap: 12,
            gridTemplateColumns: isMobile
              ? 'repeat(2, minmax(0, 1fr))'
              : 'repeat(auto-fill, minmax(min(100%, 200px), 1fr))',
            paddingInline: 16,
          }}
        >
          {items.map((p) => (
            <PresetCard
              isActive={p.slug === selectedSlug}
              key={p.slug}
              preset={p}
              onClick={onSelect}
              onZoom={setZoomPreset}
            />
          ))}
        </div>

        {/* Auto-fetch trigger. The button below stays as a fallback for
            environments where the observer never fires (no IO support, a
            zero-height scroll container) and as a keyboard-reachable
            control — an observer alone is invisible to a11y tooling. */}
        <div aria-hidden ref={sentinelRef} style={{ height: 1 }} />

        {hasNextPage && (
          <div style={{ display: 'flex', justifyContent: 'center', paddingBlock: 16 }}>
            <Button loading={isFetchingNextPage} onClick={() => loadMore.current()}>
              {t('preset.loadMore')}
            </Button>
          </div>
        )}

        {zoomPreset && (
          <PresetZoomModal
            open
            preset={zoomPreset}
            onApply={() => onSelect(zoomPreset)}
            onClose={() => setZoomPreset(null)}
          />
        )}
      </>
    );
  },
);

PresetGrid.displayName = 'PresetGrid';

export default PresetGrid;
