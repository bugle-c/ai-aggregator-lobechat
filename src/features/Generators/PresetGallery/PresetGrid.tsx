'use client';

import { useLatest } from 'ahooks';
import { Button, Empty } from 'antd';
import { createStyles } from 'antd-style';
import {
  memo,
  useCallback,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';

import { useIsMobile } from '@/hooks/useIsMobile';
import { lambdaQuery } from '@/libs/trpc/client';
import type { PresetListItem, PresetModality, PresetSort } from '@/types/preset';

import { tileAspectNumber } from '../presetAspect';
import PresetCard from '../PresetCard';
import PresetZoomModal from '../PresetZoomModal';
import MasonryGrid, { MasonryGridSkeleton } from './MasonryGrid';

const PAGE_SIZE = 24;

/**
 * How far below the fold the sentinel starts pulling the next page. One
 * viewport of lead time hides the request latency on a throttled connection
 * without pre-fetching pages the user will never scroll to.
 */
const PREFETCH_MARGIN = '600px 0px';

/** Spacing between tiles — tight, so a 4-column desktop reads as one wall. */
const TILE_GAP = 8;

/**
 * Height of the caption `PresetCard` renders under the media on mobile.
 * Fixed and known up front so the masonry can include it in the tile
 * height without measuring — keep in sync with `PresetCard`'s caption.
 */
export const MOBILE_CAPTION_HEIGHT = 40;

const presetKey = (p: PresetListItem) => p.slug;

const noop = () => () => {};

/**
 * Whether the sentinel can page at all. Read through `useSyncExternalStore`
 * so the server (and hydration) assume "yes" and a browser without the API
 * corrects it in its first client render, without a set-state-in-effect.
 */
const useHasIntersectionObserver = (): boolean =>
  useSyncExternalStore(
    noop,
    () => typeof IntersectionObserver !== 'undefined',
    () => true,
  );

const useStyles = createStyles(({ css }) => ({
  /**
   * The «Загрузить ещё» row. With the sentinel doing the paging this is a
   * keyboard / no-observer / retry fallback, and while it sat painted under
   * the grid every appended page pushed it down the viewport — the one
   * layout shift the gallery had (CLS 0.04 per page, measured). So while
   * auto-paging works it is taken out of flow and clipped to a pixel, the
   * usual visually-hidden treatment: still in the tab order, still read by
   * assistive tech, and it snaps back into flow the moment it is focused.
   */
  loadMore: css`
    display: flex;
    justify-content: center;
    padding-block: 16px;

    &[data-auto='true']:not(:focus-within) {
      position: absolute;

      overflow: hidden;

      inline-size: 1px;
      block-size: 1px;
      margin: -1px;

      white-space: nowrap;

      clip-path: inset(50%);
    }
  `,
}));

interface Props {
  category: string | undefined;
  /** True when a category / model / search filter is narrowing the list. */
  hasFilters: boolean;
  modality: PresetModality;
  /** Warm caches for a preset the user is about to pick (hover / first touch). */
  onPrefetch?: (preset: PresetListItem) => void;
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
    onPrefetch,
    onResetFilters,
    onSelect,
    q,
    selectedSlug,
    sort,
  }) => {
    const isMobile = useIsMobile();
    const { t } = useTranslation('common');
    const { styles } = useStyles();
    // Keyset pagination: the catalogue grows to ~1000 rows via the ingest
    // cron, so the gallery pulls a page at a time instead of the whole table.
    const {
      data,
      fetchNextPage,
      hasNextPage,
      isFetchNextPageError,
      isFetchingNextPage,
      isLoading,
    } = lambdaQuery.presets.list.useInfiniteQuery(
      { category, limit: PAGE_SIZE, modality, q, recommendedModelId, sort },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
        staleTime: 5 * 60 * 1000,
      },
    );

    const items = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);

    // A page landing mid-scroll used to render its 24 cards in one ~130ms
    // task. Deferring the list lets React time-slice that render behind the
    // scroll instead of blocking it; the tiles' places are reserved by the
    // masonry either way, so nothing visible waits on this.
    const deferredItems = useDeferredValue(items);

    // Without IntersectionObserver the sentinel never fires, and after a
    // failed page fetch the user needs a visible retry — both bring the
    // button back into flow.
    const hasObserver = useHasIntersectionObserver();
    const autoPaging = hasObserver && !isFetchNextPageError;

    // One modal for the whole list. It used to be one per card, so a fully
    // scrolled 1000-row gallery mounted 1000 antd dialogs.
    const [zoomPreset, setZoomPreset] = useState<PresetListItem | null>(null);

    const pageCount = data?.pages.length ?? 0;
    const loadMore = useLatest(() => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    });

    // The observer lives on a callback ref rather than in an effect: the
    // sentinel is not in the DOM on every render (the skeleton branches
    // above, including the deferred-list frame), and an effect keyed on
    // page state ran with a null ref there and never got another chance.
    // React re-invokes a callback ref whenever its identity changes, so a
    // dependency change or a late mount both (re)attach the observer.
    // `pageCount` is a dependency on purpose: an IntersectionObserver only
    // fires on a *change* in intersection, so if the sentinel is still on
    // screen after a page lands it would never fire again. Re-creating the
    // observer re-reports the current state and the scroll keeps going.
    const sentinelObserverRef = useRef<IntersectionObserver | null>(null);
    const sentinelRef = useCallback(
      (el: HTMLDivElement | null) => {
        sentinelObserverRef.current?.disconnect();
        sentinelObserverRef.current = null;
        if (!el || !hasNextPage || typeof IntersectionObserver === 'undefined') return;

        const io = new IntersectionObserver(
          (entries) => {
            if (entries.some((e) => e.isIntersecting)) loadMore.current();
          },
          { rootMargin: PREFETCH_MARGIN },
        );
        io.observe(el);
        sentinelObserverRef.current = io;
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps -- pageCount re-arms on purpose, see above
      [hasNextPage, pageCount, loadMore],
    );

    // The second clause covers the one frame in which a freshly loaded list
    // is already known but its deferred render has not caught up yet.
    if (isLoading || (items.length > 0 && deferredItems.length === 0)) {
      // Same columns and tile shape the real grid will use, so the page
      // does not flash an empty area and then jump when the list lands.
      return (
        <div style={{ paddingInline: 16 }}>
          <MasonryGridSkeleton columns={isMobile ? 2 : 4} />
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
        {/* JS masonry, not CSS multi-column and not a uniform grid.
            Multicol fills column 1 top-to-bottom before column 2, so a
            ranked 1000-row list showed ranks 1, 251, 501 and 751 side by
            side. A uniform grid kept the ranking readable but cropped
            every 9:16 and 16:9 preview into one box. The masonry keeps
            DOM order = rank (left→right placement into the shortest
            column) and gives each tile its real aspect, computed from
            `params_lock` rather than measured, so nothing shifts as media
            loads. Mobile is pinned to 2 columns; desktop picks 2–4 from
            the container width. */}
        <div style={{ paddingInline: 16 }}>
          <MasonryGrid
            captionHeight={isMobile ? MOBILE_CAPTION_HEIGHT : 0}
            columns={isMobile ? 2 : undefined}
            gap={TILE_GAP}
            getAspect={tileAspectNumber}
            getKey={presetKey}
            items={deferredItems}
            renderItem={(p) => (
              <PresetCard
                isActive={p.slug === selectedSlug}
                preset={p}
                onClick={onSelect}
                onPrefetch={onPrefetch}
                onZoom={setZoomPreset}
              />
            )}
          />
        </div>

        {/* Auto-fetch trigger. 1px tall and `flex-shrink: 0`: the gallery
            scroller is a column flexbox whose content overflows, so an
            empty 1px item is shrunk to 0 — and a zero-height target at the
            very edge of the scrollport never reports intersecting (verified:
            paging stopped once the button below left the flow). Unpainted,
            so the appended page moving it down is not a layout shift. The
            button stays as a fallback for environments where the observer
            never fires (no IO support, a zero-height scroll container), as
            the retry after a failed page, and as a keyboard-reachable
            control — an observer alone is invisible to a11y tooling. */}
        <div aria-hidden ref={sentinelRef} style={{ blockSize: 1, flexShrink: 0 }} />

        {hasNextPage && (
          <div className={styles.loadMore} data-auto={autoPaging ? 'true' : 'false'}>
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
