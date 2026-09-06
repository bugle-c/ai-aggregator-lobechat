import { describe, expect, it } from 'vitest';

import { categoryLabel, compareCategories } from './PRESET_CATEGORIES';

describe('categoryLabel', () => {
  it('has a Russian label for every ingested slug', () => {
    for (const slug of ['cinematic', 'vlog', '3d', 'ad', 'fantasy', 'trends']) {
      expect(categoryLabel(slug)).not.toMatch(/^[A-Z0-9 ]+$/i);
    }
    expect(categoryLabel('trends')).toBe('Разное');
  });

  it('falls back to a capitalized slug for unknown categories', () => {
    expect(categoryLabel('sci_fi')).toBe('Sci fi');
  });
});

describe('compareCategories', () => {
  it('orders by the fixed list, unknown slugs by count after it, trends last', () => {
    const facets = [
      { category: 'trends', count: 99 },
      { category: 'anime', count: 4 },
      { category: 'zzz', count: 1 },
      { category: 'newthing', count: 5 },
      { category: 'cinematic', count: 7 },
      { category: 'action', count: 8 },
    ];
    expect(facets.sort(compareCategories).map((f) => f.category)).toEqual([
      'cinematic',
      'action',
      'anime',
      'newthing',
      'zzz',
      'trends',
    ]);
  });
});
