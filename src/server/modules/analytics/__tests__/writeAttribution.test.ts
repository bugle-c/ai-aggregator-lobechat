import { describe, expect, it } from 'vitest';

import { type WgAttr } from '../wgAttr';
import {
  applyWgAttr,
  type AttributionCookie,
  computeAttributionRow,
  inferSourceFromReferrer,
} from '../writeAttribution';

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

  it('infers from cookie referrer when cookie has no UTM source', () => {
    // Middleware writes utm_attribution_first on every first visit, even
    // for users with no UTM params or referer. The resulting cookie has
    // all UTM fields null but still preserves the FIRST-visit referrer.
    // touchToFields must fall through to inferSourceFromReferrer using
    // the cookie's referrer (NOT the signup-request referrer, which is
    // always internal ask.gptweb.ru/signin and useless for attribution).
    const row = computeAttributionRow({
      userId: 'u4',
      firstCookie: {
        utm_source: null,
        utm_medium: null,
        utm_campaign: null,
        utm_content: null,
        referrer: 'https://yandex.ru/search/?text=webgpt',
        landing_page: '/',
        seen_at: '2026-05-17T10:00:00Z',
      },
      lastCookie: null,
      rawReferrer: 'https://ask.gptweb.ru/signin',
    });
    expect(row.firstUtmSource).toBe('yandex');
    expect(row.firstUtmMedium).toBe('organic_search');
    expect(row.firstReferrer).toBe('https://yandex.ru/search/?text=webgpt');
    expect(row.firstLandingPage).toBe('/');
  });

  it('falls back to direct when cookie has no UTM source and no referrer', () => {
    const row = computeAttributionRow({
      userId: 'u5',
      firstCookie: {
        utm_source: null,
        utm_medium: null,
        utm_campaign: null,
        utm_content: null,
        referrer: null,
        landing_page: '/signin',
        seen_at: '2026-05-17T10:00:00Z',
      },
      lastCookie: null,
    });
    expect(row.firstUtmSource).toBe('direct');
    expect(row.firstUtmMedium).toBe('none');
  });

  it('stores an empty-string referrer (direct landing visit) as null', () => {
    const row = computeAttributionRow({
      userId: 'u6',
      firstCookie: {
        utm_source: null,
        utm_medium: null,
        utm_campaign: null,
        utm_content: null,
        referrer: '',
        landing_page: '/',
        seen_at: '2026-09-13T10:00:00Z',
      },
      lastCookie: null,
      rawReferrer: 'https://gptweb.ru/',
    });
    expect(row.firstReferrer).toBeNull();
    expect(row.firstUtmSource).toBe('direct');
  });

  it('honours an explicit registeredAt (backfill for bot-native users)', () => {
    const createdAt = new Date('2026-09-13T10:10:21.231Z');
    const row = computeAttributionRow({
      userId: 'u7',
      firstCookie: {
        utm_source: 'telegram',
        utm_medium: 'bot',
        utm_campaign: 'bot_native',
        utm_content: null,
        referrer: null,
        landing_page: null,
        seen_at: createdAt.toISOString(),
      },
      lastCookie: null,
      registeredAt: createdAt,
    });
    expect(row.registeredAt).toEqual(createdAt);
    expect(row.firstUtmSource).toBe('telegram');
    expect(row.lastUtmSource).toBe('telegram');
  });
});

describe('applyWgAttr', () => {
  const wg: WgAttr = {
    lp: '/blog/chatgpt-bez-vpn',
    ref: 'https://yandex.ru/search/?text=chatgpt',
    ts: '2026-09-13T10:00:00.000Z',
    ym: '1712345678901234567',
  };

  // What the middleware wrote BEFORE wg_attr existed: rewritten app path,
  // origin-only internal referer, no Metrika id.
  const legacyAppCookie: AttributionCookie = {
    landing_page: '/ru-RU__0?auth=signup',
    referrer: 'https://gptweb.ru/',
    seen_at: '2026-09-13T10:05:00.000Z',
    utm_campaign: 'hero',
    utm_content: 'primary_register',
    utm_medium: 'cta',
    utm_source: 'landing',
  };

  it('returns the cookie unchanged when there is no wg_attr', () => {
    expect(applyWgAttr(legacyAppCookie, null)).toBe(legacyAppCookie);
    expect(applyWgAttr(null, null)).toBeNull();
  });

  it('builds a first-touch cookie from wg_attr alone', () => {
    expect(applyWgAttr(null, wg)).toEqual({
      landing_page: wg.lp,
      referrer: wg.ref,
      seen_at: wg.ts,
      utm_campaign: null,
      utm_content: null,
      utm_medium: null,
      utm_source: null,
      ym_client_id: wg.ym,
    });
  });

  it('lets the earlier landing touch override the later app-side fallback values', () => {
    const merged = applyWgAttr(legacyAppCookie, wg)!;
    expect(merged.landing_page).toBe('/blog/chatgpt-bez-vpn');
    expect(merged.referrer).toBe('https://yandex.ru/search/?text=chatgpt');
    expect(merged.seen_at).toBe('2026-09-13T10:00:00.000Z');
    expect(merged.ym_client_id).toBe('1712345678901234567');
    // UTM fields are the middleware's business — untouched.
    expect(merged.utm_source).toBe('landing');
    expect(merged.utm_campaign).toBe('hero');
  });

  it('keeps the app cookie when it is the earlier touch, only filling gaps', () => {
    const olderAppCookie: AttributionCookie = {
      ...legacyAppCookie,
      landing_page: '/pricing',
      referrer: 'https://t.me/somechannel',
      seen_at: '2026-08-01T00:00:00.000Z',
    };
    const merged = applyWgAttr(olderAppCookie, wg)!;
    expect(merged.landing_page).toBe('/pricing');
    expect(merged.referrer).toBe('https://t.me/somechannel');
    expect(merged.seen_at).toBe('2026-08-01T00:00:00.000Z');
    // Metrika id is an identity, not a touch: filled from wg_attr.
    expect(merged.ym_client_id).toBe('1712345678901234567');
  });

  it('never overwrites an existing Metrika id', () => {
    const merged = applyWgAttr({ ...legacyAppCookie, ym_client_id: 'existing' }, wg)!;
    expect(merged.ym_client_id).toBe('existing');
  });

  it('treats an empty wg referrer as a real (direct) value when wg is first', () => {
    const merged = applyWgAttr(legacyAppCookie, { ...wg, ref: '' })!;
    expect(merged.referrer).toBe('');
    const row = computeAttributionRow({ firstCookie: merged, lastCookie: null, userId: 'u8' });
    expect(row.firstReferrer).toBeNull();
    expect(row.firstLandingPage).toBe('/blog/chatgpt-bez-vpn');
    // utm_source=landing is explicit in the cookie, so no inference happens.
    expect(row.firstUtmSource).toBe('landing');
  });

  it('end-to-end: wg_attr fixes the legacy row for an organic blog reader', () => {
    const organicAppCookie: AttributionCookie = {
      landing_page: '/ru-RU__0',
      referrer: 'https://gptweb.ru/',
      seen_at: '2026-09-13T10:05:00.000Z',
      utm_campaign: null,
      utm_content: null,
      utm_medium: null,
      utm_source: null,
    };
    const row = computeAttributionRow({
      firstCookie: applyWgAttr(organicAppCookie, wg),
      lastCookie: null,
      rawReferrer: 'https://ask.gptweb.ru/signin',
      userId: 'u9',
    });
    expect(row.firstLandingPage).toBe('/blog/chatgpt-bez-vpn');
    expect(row.firstReferrer).toBe('https://yandex.ru/search/?text=chatgpt');
    expect(row.firstUtmSource).toBe('yandex');
    expect(row.firstUtmMedium).toBe('organic_search');
    expect(row.firstYmClientId).toBe('1712345678901234567');
  });
});
