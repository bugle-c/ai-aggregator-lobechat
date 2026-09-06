/**
 * Pure masonry arithmetic — no DOM, no React.
 *
 * Every tile's height is known up front (`columnWidth / aspect` plus a fixed
 * caption), so the layout is a deterministic fold over the ranked list: each
 * item goes to the currently shortest column, ties break to the leftmost.
 * Nothing is ever measured, which is what keeps the grid stable while
 * posters and videos are still loading.
 */

export interface MasonryParams {
  /** Extra height under the media box (mobile caption), in px. */
  captionHeight: number;
  columns: number;
  columnWidth: number;
  gap: number;
}

export interface MasonryPosition {
  height: number;
  x: number;
  y: number;
}

export interface MasonryLayout {
  /** Running bottom edge per column, so a later page can continue from here. */
  columnHeights: number[];
  /** Total content height = the tallest column. */
  height: number;
  params: MasonryParams;
  positions: MasonryPosition[];
}

export const emptyMasonryLayout = (params: MasonryParams): MasonryLayout => ({
  columnHeights: Array.from({ length: Math.max(1, params.columns) }, () => 0),
  height: 0,
  params,
  positions: [],
});

export const sameMasonryParams = (a: MasonryParams, b: MasonryParams): boolean =>
  a.columns === b.columns &&
  a.columnWidth === b.columnWidth &&
  a.gap === b.gap &&
  a.captionHeight === b.captionHeight;

/**
 * Lays out `aspects` (width / height per item, in rank order).
 *
 * Pass `previous` to extend an existing layout: the first
 * `previous.positions.length` items keep their positions untouched and only
 * the tail is placed. Callers must only do this when the leading items are
 * the same ones — the function trusts the prefix.
 */
export const layoutMasonry = (
  aspects: readonly number[],
  params: MasonryParams,
  previous?: MasonryLayout,
): MasonryLayout => {
  const base =
    previous && sameMasonryParams(previous.params, params) && previous.positions.length <= aspects.length
      ? previous
      : emptyMasonryLayout(params);

  const columnHeights = [...base.columnHeights];
  const positions = base.positions.slice();
  const { captionHeight, columnWidth, gap } = params;

  for (let i = positions.length; i < aspects.length; i++) {
    // Shortest column wins; on a tie the leftmost, so a fresh page of
    // equal-height tiles still reads left→right.
    let col = 0;
    for (let c = 1; c < columnHeights.length; c++) {
      if (columnHeights[c] < columnHeights[col]) col = c;
    }

    const aspect = aspects[i] > 0 ? aspects[i] : 1;
    const height = Math.round(columnWidth / aspect) + captionHeight;
    const y = columnHeights[col];
    positions.push({ height, x: col * (columnWidth + gap), y });
    columnHeights[col] = y + height + gap;
  }

  // Trailing gap is spacing between rows, not part of the content height.
  const height = positions.length === 0 ? 0 : Math.max(...columnHeights) - gap;

  return { columnHeights, height, params, positions };
};

/** Column count from the container width — mirrors the UX spec breakpoints. */
export const columnsForWidth = (width: number): number => {
  if (width < 800) return 2;
  if (width < 1100) return 3;
  return 4;
};

/** Width of one column for a container `width` with `columns` and `gap`. */
export const columnWidthFor = (width: number, columns: number, gap: number): number =>
  Math.max(0, Math.floor((width - gap * (columns - 1)) / columns));
