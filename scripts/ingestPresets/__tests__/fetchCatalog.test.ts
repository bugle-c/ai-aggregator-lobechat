import { describe, expect, it } from 'vitest';

import { catalogUrl, discoverNewItems, extractJson, parseCatalogPage } from '../fetchCatalog';

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

describe('discoverNewItems', () => {
  const item = (id: string) => ({ id, prompt: 'p', title: 't' }) as any;
  // page 0: all known · page 1: two fresh · page 2: last page, one fresh
  const pages = [
    { hasMore: true, items: [item('k1'), item('k2')] },
    { hasMore: true, items: [item('f1'), item('f2')] },
    { hasMore: false, items: [item('f3')] },
  ];
  const fetchPage = (async (_m: any, offset: number) => pages[offset / 20]) as any;
  const known = new Set(['k1', 'k2']);

  it('stops at the first all-known page by default (the daily watermark)', async () => {
    const r = await discoverNewItems('video', { fetchPage, known, maxNew: 50, maxPages: 10 });
    expect(r.stoppedBecause).toBe('known-page');
    expect(r.fresh).toEqual([]);
    expect(r.pagesFetched).toBe(1);
  });

  it('walks past known pages in backfill mode until the feed ends', async () => {
    const r = await discoverNewItems('video', {
      fetchPage,
      known,
      maxNew: 50,
      maxPages: 10,
      stopOnKnownPage: false,
    });
    expect(r.stoppedBecause).toBe('exhausted');
    expect(r.fresh.map((i: any) => i.id)).toEqual(['f1', 'f2', 'f3']);
    expect(r.pagesFetched).toBe(3);
  });

  it('still honours maxNew in backfill mode', async () => {
    const r = await discoverNewItems('video', {
      fetchPage,
      known,
      maxNew: 2,
      maxPages: 10,
      stopOnKnownPage: false,
    });
    expect(r.stoppedBecause).toBe('max-new');
    expect(r.fresh.map((i: any) => i.id)).toEqual(['f1', 'f2']);
  });
});
