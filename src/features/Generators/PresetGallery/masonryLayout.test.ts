import { describe, expect, it } from 'vitest';

import { columnsForWidth, columnWidthFor, layoutMasonry } from './masonryLayout';

const params = { captionHeight: 0, columnWidth: 100, columns: 3, gap: 10 };

describe('layoutMasonry', () => {
  it('places items in rank order into the shortest column, leftmost on ties', () => {
    // 1:1 → 100 tall, 1:2 → 200 tall, 2:1 → 50 tall
    const layout = layoutMasonry([1, 0.5, 2, 1, 1], params);

    expect(layout.positions).toEqual([
      { height: 100, x: 0, y: 0 }, // rank 1 → col 0
      { height: 200, x: 110, y: 0 }, // rank 2 → col 1
      { height: 50, x: 220, y: 0 }, // rank 3 → col 2
      { height: 100, x: 220, y: 60 }, // rank 4 → col 2 (shortest: 60)
      { height: 100, x: 0, y: 110 }, // rank 5 → col 0 (110) beats col 2 (170)
    ]);
    expect(layout.columnHeights).toEqual([220, 210, 170]);
    // Tallest column minus the trailing gap.
    expect(layout.height).toBe(210);
  });

  it('adds the caption height to every tile', () => {
    const layout = layoutMasonry([1, 1], { ...params, captionHeight: 40 });
    expect(layout.positions[0].height).toBe(140);
    expect(layout.positions[1]).toEqual({ height: 140, x: 110, y: 0 });
  });

  it('extends a previous layout without moving already placed tiles', () => {
    const first = layoutMasonry([1, 0.5, 2], params);
    const extended = layoutMasonry([1, 0.5, 2, 1, 1], params, first);

    expect(extended.positions.slice(0, 3)).toEqual(first.positions);
    expect(extended).toEqual(layoutMasonry([1, 0.5, 2, 1, 1], params));
  });

  it('ignores a previous layout computed with different parameters', () => {
    const narrow = layoutMasonry([1, 1, 1], params);
    const wide = layoutMasonry([1, 1, 1, 1], { ...params, columnWidth: 200 }, narrow);

    expect(wide.positions[0].height).toBe(200);
    expect(wide.positions.map((p) => p.x)).toEqual([0, 210, 420, 0]);
  });

  it('handles an empty list and a degenerate aspect', () => {
    expect(layoutMasonry([], params).height).toBe(0);
    expect(layoutMasonry([0], params).positions[0].height).toBe(100);
  });
});

describe('column helpers', () => {
  it('picks columns from the container width', () => {
    expect(columnsForWidth(375)).toBe(2);
    expect(columnsForWidth(799)).toBe(2);
    expect(columnsForWidth(800)).toBe(3);
    expect(columnsForWidth(1099)).toBe(3);
    expect(columnsForWidth(1100)).toBe(4);
  });

  it('splits the width evenly after removing the gaps', () => {
    expect(columnWidthFor(1056 - 32, 4, 8)).toBe(250);
    expect(columnWidthFor(375 - 24, 2, 8)).toBe(171);
    expect(columnWidthFor(0, 2, 8)).toBe(0);
  });
});
