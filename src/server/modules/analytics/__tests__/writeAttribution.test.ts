import { describe, expect, it } from 'vitest';

import { computeAttributionRow, inferSourceFromReferrer } from '../writeAttribution';

describe('inferSourceFromReferrer', () => {
  it('returns direct when no referrer', () => {
    expect(inferSourceFromReferrer(null)).toEqual({ source: 'direct', medium: 'none' });
    expect(inferSourceFromReferrer('')).toEqual({ source: 'direct', medium: 'none' });
  });

  it('recognises yandex search', () => {
    expect(inferSourceFromReferrer('https://yandex.ru/search/?text=foo')).toEqual({
      source: 'yandex',
      medium: 'organic_search',
    });
  });

  it('recognises google search', () => {
    expect(inferSourceFromReferrer('https://www.google.com/search?q=foo')).toEqual({
      source: 'google',
      medium: 'organic_search',
    });
  });

  it('recognises generic referrer as referral', () => {
    expect(inferSourceFromReferrer('https://example.com/page')).toEqual({
      source: 'example.com',
      medium: 'referral',
    });
  });
});

describe('computeAttributionRow', () => {
  it('uses explicit UTM when present', () => {
    const row = computeAttributionRow({
      userId: 'u1',
      firstCookie: {
        utm_source: 'yandex_direct',
        utm_medium: 'cpc',
        utm_campaign: 'spring',
        utm_content: 'ad1',
        referrer: 'https://yandex.ru',
        landing_page: '/?utm_source=yandex_direct',
        seen_at: '2026-04-01T10:00:00Z',
      },
      lastCookie: {
        utm_source: 'telegram_ads',
        utm_medium: 'cpc',
        utm_campaign: 'april',
        utm_content: null,
        referrer: 'https://t.me/channel',
        landing_page: '/pricing',
        seen_at: '2026-04-18T12:00:00Z',
      },
    });

    expect(row.firstUtmSource).toBe('yandex_direct');
    expect(row.firstUtmMedium).toBe('cpc');
    expect(row.lastUtmSource).toBe('telegram_ads');
    expect(row.lastLandingPage).toBe('/pricing');
    expect(row.userId).toBe('u1');
  });

  it('falls back to direct/referrer inference when cookies absent', () => {
    const row = computeAttributionRow({
      userId: 'u2',
      firstCookie: null,
      lastCookie: null,
      rawReferrer: 'https://google.com/search?q=webgpt',
    });

    expect(row.firstUtmSource).toBe('google');
    expect(row.firstUtmMedium).toBe('organic_search');
    expect(row.lastUtmSource).toBe('google');
  });

  it('uses direct when no cookie and no referrer', () => {
    const row = computeAttributionRow({
      userId: 'u3',
      firstCookie: null,
      lastCookie: null,
    });
    expect(row.firstUtmSource).toBe('direct');
    expect(row.firstUtmMedium).toBe('none');
  });
});
