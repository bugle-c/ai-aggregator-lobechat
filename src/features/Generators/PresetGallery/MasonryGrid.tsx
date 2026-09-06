'use client';

import { createStyles } from 'antd-style';
import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react';

import {
  columnsForWidth,
  columnWidthFor,
  layoutMasonry,
  type MasonryLayout,
  sameMasonryParams,
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
  renderItem: (item: T, index: number) => ReactNode;
}

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    position: relative;

    /* The focus ring of an absolutely positioned tile must not be clipped. */
    overflow: visible;

    inline-size: 100%;
  `,
  item: css`
    position: absolute;
    inset-block-start: 0;
    inset-inline-start: 0;
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
}));

/** How many placeholder boxes the pre-measure frame shows. */
const SKELETON_COUNT = 8;

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
  renderItem,
}: Props<T>) {
  const { styles } = useStyles();
  const [width, setWidth] = useState(0);

  // Measured through a callback ref: the width is read the moment the
  // container mounts (before paint, so the first frame is already the real
  // layout when the container has a size) and tracked from then on.
  const observerRef = useRef<ResizeObserver | null>(null);
  const containerRef = useCallback((el: HTMLDivElement | null) => {
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
      {items.map((item, i) => {
        const pos = layout.positions[i];
        return (
          <div
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
