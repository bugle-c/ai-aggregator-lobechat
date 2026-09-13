import { describe, expect, it } from 'vitest';

import { parseWgAttr, readCookieValue, WG_ATTR_COOKIE } from '../wgAttr';

const encode = (obj: unknown) => encodeURIComponent(JSON.stringify(obj));

describe('parseWgAttr', () => {
  it('returns null for missing or malformed input', () => {
    expect(parseWgAttr(undefined)).toBeNull();
    expect(parseWgAttr(null)).toBeNull();
    expect(parseWgAttr('')).toBeNull();
    expect(parseWgAttr('not json')).toBeNull();
    expect(parseWgAttr('%7Bbroken')).toBeNull();
    expect(parseWgAttr(encode('a string'))).toBeNull();
    expect(parseWgAttr(encode([1, 2]))).toBeNull();
    expect(parseWgAttr(encode(null))).toBeNull();
  });

  it('parses a URI-encoded landing cookie', () => {
    const raw = encode({
      lp: '/blog/chatgpt-bez-vpn?utm_source=yandex&utm_medium=cpc',
      ref: 'https://yandex.ru/search/?text=chatgpt',
      ts: '2026-09-13T10:00:00.000Z',
      ym: '1712345678901234567',
    });
    expect(parseWgAttr(raw)).toEqual({
      lp: '/blog/chatgpt-bez-vpn?utm_source=yandex&utm_medium=cpc',
      ref: 'https://yandex.ru/search/?text=chatgpt',
      ts: '2026-09-13T10:00:00.000Z',
      ym: '1712345678901234567',
    });
  });

  it('accepts a plain (non-encoded) JSON value too', () => {
    expect(parseWgAttr('{"lp":"/","ref":"","ts":"2026-09-13T10:00:00Z"}')).toEqual({
      lp: '/',
      ref: '',
      ts: '2026-09-13T10:00:00Z',
      ym: null,
    });
  });

  it('keeps an empty referrer as "" (direct visit) but maps missing fields to null', () => {
    const parsed = parseWgAttr(encode({ lp: '/', ref: '' }));
    expect(parsed).toEqual({ lp: '/', ref: '', ts: null, ym: null });
  });

  it('coerces wrong types and invalid timestamps to null', () => {
    const parsed = parseWgAttr(encode({ lp: '/pricing', ref: 42, ts: 'yesterday', ym: {} }));
    expect(parsed).toEqual({ lp: '/pricing', ref: null, ts: null, ym: null });
  });

  it('treats a cookie with no usable fields as absent', () => {
    expect(parseWgAttr(encode({ ts: '2026-09-13T10:00:00Z' }))).toBeNull();
    expect(parseWgAttr(encode({ lp: '', ref: '', ym: '' }))).toBeNull();
    expect(parseWgAttr(encode({}))).toBeNull();
  });

  it('clamps oversized fields', () => {
    const long = 'a'.repeat(5000);
    const parsed = parseWgAttr(encode({ lp: `/${long}`, ref: `https://x.ru/${long}` }));
    expect(parsed?.lp?.length).toBe(1000);
    expect(parsed?.ref?.length).toBe(1000);
  });
});

describe('readCookieValue', () => {
  const header = `_ga=GA1.1.1; ${WG_ATTR_COOKIE}=%7B%22lp%22%3A%22%2F%22%7D; utm_attribution_first={"a":1}; empty=`;

  it('reads a named cookie from a Cookie header without decoding it', () => {
    expect(readCookieValue(header, WG_ATTR_COOKIE)).toBe('%7B%22lp%22%3A%22%2F%22%7D');
    expect(readCookieValue(header, 'utm_attribution_first')).toBe('{"a":1}');
    expect(readCookieValue(header, '_ga')).toBe('GA1.1.1');
  });

  it('does not match on prefixes and returns null for empty/missing values', () => {
    expect(readCookieValue(header, 'wg')).toBeNull();
    expect(readCookieValue(header, 'utm_attribution')).toBeNull();
    expect(readCookieValue(header, 'empty')).toBeNull();
    expect(readCookieValue(header, 'nope')).toBeNull();
    expect(readCookieValue(null, WG_ATTR_COOKIE)).toBeNull();
    expect(readCookieValue('', WG_ATTR_COOKIE)).toBeNull();
  });

  it('round-trips with parseWgAttr', () => {
    expect(parseWgAttr(readCookieValue(header, WG_ATTR_COOKIE))).toEqual({
      lp: '/',
      ref: null,
      ts: null,
      ym: null,
    });
  });
});
