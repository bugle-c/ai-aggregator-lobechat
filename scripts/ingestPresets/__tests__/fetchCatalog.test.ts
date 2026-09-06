import { describe, expect, it } from 'vitest';

import { catalogUrl, extractJson, parseCatalogPage } from '../fetchCatalog';

const page = (items: unknown[], key: 'images' | 'videos' = 'images', extra = {}) =>
  JSON.stringify({ [key]: items, hasMore: true, ...extra });

describe('catalogUrl', () => {
  it('always goes through the reader proxy and paginates by offset', () => {
    expect(catalogUrl('video', 0)).toBe(
      'https://r.jina.ai/https://www.meigen.ai/api/videos?offset=0',
    );
    expect(catalogUrl('image', 40)).toBe(
      'https://r.jina.ai/https://www.meigen.ai/api/images?offset=40',
    );
  });
});

describe('extractJson', () => {
  it('parses a plain body', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('salvages a fenced body', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('salvages a body with a reader preamble', () => {
    expect(extractJson('Title: meigen\nURL Source: https://x\n\n{"a":1}\n')).toEqual({ a: 1 });
  });

  it('throws on a challenge page rather than returning junk', () => {
    expect(() => extractJson('<html>Just a moment…</html>')).toThrow(/non-JSON/);
  });
});

describe('parseCatalogPage', () => {
  it('reads the videos endpoint even though it ships its array under "images"', () => {
    const result = parseCatalogPage(page([{ id: '1' }, { id: '2' }], 'images'));
    expect(result.items).toHaveLength(2);
    expect(result.hasMore).toBe(true);
  });

  it('reads a "videos" key too', () => {
    expect(parseCatalogPage(page([{ id: '1' }], 'videos')).items).toHaveLength(1);
  });

  it('surfaces totalCount when present', () => {
    expect(parseCatalogPage(page([{ id: '1' }], 'images', { totalCount: 7153 })).totalCount).toBe(
      7153,
    );
  });

  it('drops malformed entries instead of failing the page', () => {
    const result = parseCatalogPage(page([{ id: '1' }, null, {}, { id: '' }]));
    expect(result.items.map((i) => i.id)).toEqual(['1']);
  });

  it('treats a missing hasMore as the end of the catalogue', () => {
    expect(parseCatalogPage('{"images":[]}').hasMore).toBe(false);
  });

  it('throws when the payload has no recognisable array', () => {
    expect(() => parseCatalogPage('{"results":[]}')).toThrow(/neither/);
  });
});
