'use client';

import { createStyles, keyframes } from 'antd-style';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  columnsForWidth,
  columnWidthFor,
  layoutMasonry,
  type MasonryLayout,
  sameMasonryParams,
  visibleIndices,
} from './masonryLayout';

interface Props<T> {
  /** Fixed height under each tile's media box (the mobile caption). */
  captionHeight?: number;
  /** Pins the column count; omitted → derived from the container width. */
  columns?: number;
  gap?: number;
  /** Width / height of the tile's media box, e.g. `tileAspectNumber`. */
  getAspect: (item: T) => number;
  getKey: (item: T) => string;
  items: readonly T[];
  /**
   * Extra distance above and below the viewport that still gets rendered
   * when `windowed`, in px. One overscan of lead time hides the mount of a
   * row during a normal scroll; a fling still outruns it, which is why the
   * tiles below are posters first.
   */
  overscan?: number;
  renderItem: (item: T, index: number) => ReactNode;
  /**
   * Render only the tiles near the viewport. Positions are absolute anyway,
   * so this is a filter over the layout, not a different layout: the
   * container keeps its full height and nothing moves when tiles mount or
   * unmount. Off by default — the caller turns it on past a size threshold.
   */
  windowed?: boolean;
}

const fadeIn = keyframes`
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
`;

const useStyles = createStyles(({ css, token }) => {
  return {
    container: css`
      position: relative;

      /* The focus ring of an absolutely positioned tile must not be clipped. */
      overflow: visible;

      inline-size: 100%;
    `,
    /**
     * Tiles are placed by transform, never by flow, so an appended page
     * cannot push anything that is already on screen; the new ones simply
     * fade in where the layout already reserved their place. Opacity is
     * compositor-only, so 24 tiles fading at once costs no layout or paint.
     */
    item: css`
      position: absolute;
      inset-block-start: 0;
      inset-inline-start: 0;

      animation: ${fadeIn} 180ms ease-out both;

      @media (prefers-reduced-motion: reduce) {
        animation: none;
      }
    `,
    skeletonGrid: css`
      display: grid;
      gap: 8px;
    `,
    skeletonBox: css`
      aspect-ratio: 3 / 4;
      border-radius: 12px;
      background: ${token.colorFillTertiary};
    `,
  };
});

/** How many placeholder boxes the pre-measure frame shows. */
const SKELETON_COUNT = 8;

const DEFAULT_OVERSCAN = 1000;

/**
 * Placeholder for the frame before the container is measured (and for the
 * gallery's initial fetch): eight 3:4 boxes in the same columns, so the
 * screen never flashes empty and the real layout lands without a jump.
 * No shimmer — a static fill respects `prefers-reduced-motion` for free.
 */
export const MasonryGridSkeleton = ({
  columns = 2,
  count = SKELETON_COUNT,
}: {
  columns?: number;
  count?: number;
}) => {
  const { styles } = useStyles();
  return (
    <div
      aria-busy
      aria-hidden
      className={styles.skeletonGrid}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: count }, (_, i) => (
        <div className={styles.skeletonBox} key={i} />
      ))}
    </div>
  );
};

/** The nearest ancestor that actually scrolls vertically, else the window. */
const findScrollHost = (el: HTMLElement): HTMLElement | Window => {
  let node = el.parentElement;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight)
      return node;
    node = node.parentElement;
  }
  return window;
};

interface Window_ {
  end: number;
  start: number;
}

/**
 * Masonry that never measures a tile.
 *
 * One `ResizeObserver` on the container gives the column width; every
 * tile's height follows from its aspect ratio (`layoutMasonry`), so the
 * layout is settled before a single poster has loaded and does not move
 * when one does. Items are absolutely positioned in rank order — DOM order
 * is the ranking, so Tab and screen readers walk the list the way it was
 * curated, even where a shorter tile in the next column sits visually
 * higher. Appending a page keeps every existing tile where it was.
 */
function MasonryGrid<T>({
  captionHeight = 0,
  columns: columnsProp,
  gap = 8,
  getAspect,
  getKey,
  items,
  overscan = DEFAULT_OVERSCAN,
  renderItem,
  windowed = false,
}: Props<T>) {
  const { styles } = useStyles();
  const [width, setWidth] = useState(0);
  const nodeRef = useRef<HTMLDivElement | null>(null);

  // Measured through a callback ref: the width is read the moment the
  // container mounts (before paint, so the first frame is already the real
  // layout when the container has a size) and tracked from then on.
  const observerRef = useRef<ResizeObserver | null>(null);
  const containerRef = useCallback((el: HTMLDivElement | null) => {
    nodeRef.current = el;
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el) return;

    setWidth(el.clientWidth);

    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === 'number') setWidth(Math.floor(w));
    });
    ro.observe(el);
    observerRef.current = ro;
  }, []);

  // The visible window in container coordinates, committed with hysteresis:
  // a new range is stored only once the viewport has moved half an overscan
  // from the last one, so a scroll re-renders the list a few times per
  // screen, not once per frame.
  const [window_, setWindow] = useState<Window_ | null>(null);
  const windowRef = useRef<Window_ | null>(null);

  useEffect(() => {
    const el = nodeRef.current;
    if (!windowed || !el) {
      windowRef.current = null;
      return;
    }
    const host = findScrollHost(el);
    let raf = 0;

    const measure = () => {
      raf = 0;
      const hostTop = host instanceof Window ? 0 : host.getBoundingClientRect().top;
      const hostHeight = host instanceof Window ? host.innerHeight : host.clientHeight;
      const top = el.getBoundingClientRect().top - hostTop;
      const next = { end: -top + hostHeight + overscan, start: -top - overscan };
      const prev = windowRef.current;
      if (prev && Math.abs(prev.start - next.start) < overscan / 2) return;
      windowRef.current = next;
      setWindow(next);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };

    // First measurement on the next frame (not synchronously inside the
    // effect); until then every tile renders, which is what happened before.
    onScroll();
    host.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      host.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [overscan, windowed]);

  const columns = columnsProp ?? columnsForWidth(width);
  const columnWidth = columnWidthFor(width, columns, gap);

  // Incremental layout across pages: reuse the previous result when the
  // parameters match and the previously laid-out prefix is the same list
  // (react-query keeps page item references stable across appends).
  const previousRef = useRef<{ lastItem: T | undefined; layout: MasonryLayout } | null>(null);

  const layout = useMemo(() => {
    const params = { captionHeight, columnWidth, columns, gap };
    const prev = previousRef.current;
    const count = prev?.layout.positions.length ?? 0;
    const canExtend =
      !!prev &&
      sameMasonryParams(prev.layout.params, params) &&
      count <= items.length &&
      (count === 0 || items[count - 1] === prev.lastItem);

    const aspects = items.map(getAspect);
    const next = layoutMasonry(aspects, params, canExtend ? prev.layout : undefined);
    previousRef.current = { lastItem: items.at(-1), layout: next };
    return next;
  }, [captionHeight, columnWidth, columns, gap, getAspect, items]);

  const indices = useMemo(
    () =>
      windowed && window_
        ? visibleIndices(layout.positions, window_.start, window_.end)
        : items.map((_, i) => i),
    [items, layout.positions, window_, windowed],
  );

  if (width === 0 || columnWidth === 0) {
    return (
      <div className={styles.container} ref={containerRef}>
        <MasonryGridSkeleton columns={columns} />
      </div>
    );
  }

  return (
    <div
      className={styles.container}
      ref={containerRef}
      role="list"
      style={{ blockSize: layout.height }}
    >
      {indices.map((i) => {
        const item = items[i];
        const pos = layout.positions[i];
        return (
          <div
            aria-posinset={i + 1}
            aria-setsize={items.length}
            className={styles.item}
            key={getKey(item)}
            role="listitem"
            style={{
              inlineSize: columnWidth,
              transform: `translate(${pos.x}px, ${pos.y}px)`,
            }}
          >
            {renderItem(item, i)}
          </div>
        );
      })}
    </div>
  );
}

export default MasonryGrid;
