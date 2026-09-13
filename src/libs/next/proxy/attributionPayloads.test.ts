import { describe, expect, it } from 'vitest';

import { parseWgAttr } from '@/server/modules/analytics/wgAttr';
import { applyWgAttr, computeAttributionRow } from '@/server/modules/analytics/writeAttribution';

import {
  ATTR_URL_MAX_LEN,
  buildAttributionPayloads,
  parseLandingUtms,
  SAME_VISIT_TOLERANCE_MS,
  utmsBelongToFirstTouch,
} from './attributionPayloads';

const enc = (o: unknown) => encodeURIComponent(JSON.stringify(o));
const NOW = new Date('2026-09-13T12:00:00.000Z');

// Organic blog reader: landing stamped wg_attr at 10:00, no utm anywhere.
const WG = {
  lp: '/blog/chatgpt-bez-vpn',
  ref: 'https://yandex.ru/search/',
  ts: '2026-09-13T10:00:00.000Z',
  ym: '1712345678901234567',
};

// What TrackedLink puts on every landing → app click.
const CTA_URL = new URLSearchParams(
  'auth=signup&utm_source=landing&utm_medium=cta&utm_campaign=blog&utm_content=cta_bottom',
);

const baseCtx = {
  now: NOW,
  referer: 'https://gptweb.ru/',
  requestedPath: '/?auth=signup&utm_source=landing&utm_medium=cta&utm_campaign=blog',
  searchParams: CTA_URL,
};

describe('buildAttributionPayloads', () => {
  it('no landing cookies, no utm: both touches come from the request', () => {
    const { first, last, hasUtmInUrl } = buildAttributionPayloads({
      now: NOW,
      referer: 'https://t.me/somechannel',
      requestedPath: '/pricing',
      searchParams: new URLSearchParams(''),
    });
    expect(hasUtmInUrl).toBe(false);
    for (const p of [first, last]) {
      expect(p.landing_page).toBe('/pricing');
      expect(p.referrer).toBe('https://t.me/somechannel');
      expect(p.seen_at).toBe(NOW.toISOString());
      expect(p.utm_source).toBeNull();
      expect(p.ym_client_id).toBeNull();
    }
  });

  it('wg_attr present: FIRST is landing-derived, LAST is request-derived (review #1)', () => {
    const { first, last, hasUtmInUrl } = buildAttributionPayloads({
      ...baseCtx,
      wgAttrRaw: enc(WG),
    });
    expect(hasUtmInUrl).toBe(true);

    expect(first.landing_page).toBe('/blog/chatgpt-bez-vpn');
    expect(first.referrer).toBe('https://yandex.ru/search/');
    expect(first.seen_at).toBe(WG.ts);
    expect(first.ym_client_id).toBe(WG.ym);
    // TrackedLink's utm_source=landing is a later touch → not first.
    expect(first.utm_source).toBeNull();
    expect(first.utm_medium).toBeNull();
    expect(first.utm_campaign).toBeNull();

    expect(last.landing_page).toBe(baseCtx.requestedPath);
    expect(last.referrer).toBe('https://gptweb.ru/');
    expect(last.seen_at).toBe(NOW.toISOString());
    expect(last.utm_source).toBe('landing');
    expect(last.utm_medium).toBe('cta');
    expect(last.utm_campaign).toBe('blog');
    expect(last.utm_content).toBe('cta_bottom');
    // identity is shared
    expect(last.ym_client_id).toBe(WG.ym);
  });

  it('same-visit paid landing: utm cookie stamped with wg_attr stays on FIRST', () => {
    const paidUtms = {
      landingPage: '/?utm_source=yandex_direct&utm_medium=cpc',
      referrer: 'https://yandex.ru/',
      seenAt: '2026-09-13T09:59:59.900Z', // 100 ms before wg (same effect)
      utm_campaign: 'spring',
      utm_content: 'ad1',
      utm_medium: 'cpc',
      utm_source: 'yandex_direct',
    };
    const { first, last } = buildAttributionPayloads({
      ...baseCtx,
      gptwebUtmsRaw: enc(paidUtms),
      searchParams: new URLSearchParams('utm_source=yandex_direct&utm_medium=cpc'),
      wgAttrRaw: enc(WG),
    });
    expect(first.utm_source).toBe('yandex_direct');
    expect(first.utm_medium).toBe('cpc');
    expect(first.utm_campaign).toBe('spring');
    expect(first.landing_page).toBe(WG.lp);
    expect(last.utm_source).toBe('yandex_direct');
  });

  it('mixed touch: organic first visit, utm visit later → FIRST utm_* nulled (review #2)', () => {
    const laterUtms = {
      landingPage: '/?utm_source=telegram_ads',
      referrer: 'https://t.me/ad',
      seenAt: new Date(Date.parse(WG.ts) + SAME_VISIT_TOLERANCE_MS + 1).toISOString(),
      utm_campaign: 'sept',
      utm_content: null,
      utm_medium: 'cpc',
      utm_source: 'telegram_ads',
    };
    const { first, last } = buildAttributionPayloads({
      ...baseCtx,
      gptwebUtmsRaw: enc(laterUtms),
      searchParams: new URLSearchParams('utm_source=telegram_ads&utm_medium=cpc'),
      wgAttrRaw: enc(WG),
    });
    expect(first.utm_source).toBeNull();
    expect(first.utm_medium).toBeNull();
    expect(first.utm_campaign).toBeNull();
    expect(first.landing_page).toBe(WG.lp);
    expect(first.referrer).toBe(WG.ref);
    expect(first.seen_at).toBe(WG.ts);
    expect(last.utm_source).toBe('telegram_ads');
    expect(last.utm_campaign).toBe('sept'); // URL has no campaign → landing cookie fills it

    // End-to-end: the stored FIRST row is organic yandex, not telegram_ads.
    const row = computeAttributionRow({
      firstCookie: applyWgAttr(first, parseWgAttr(enc(WG))),
      lastCookie: last,
      rawReferrer: 'https://ask.gptweb.ru/signin',
      userId: 'u1',
    });
    expect(row.firstUtmSource).toBe('yandex');
    expect(row.firstUtmMedium).toBe('organic_search');
    expect(row.firstLandingPage).toBe('/blog/chatgpt-bez-vpn');
    expect(row.lastUtmSource).toBe('telegram_ads');
    expect(row.lastLandingPage).toBe(baseCtx.requestedPath);
  });

  it('legacy path (no wg_attr): landing utm cookie feeds FIRST, URL wins for utm', () => {
    const utms = {
      landingPage: '/?utm_source=yandex_direct',
      referrer: 'https://yandex.ru/',
      seenAt: '2026-09-13T09:00:00.000Z',
      utm_campaign: 'spring',
      utm_medium: 'cpc',
      utm_source: 'yandex_direct',
      ymClientId: 'from-utms',
    };
    const { first, last } = buildAttributionPayloads({
      ...baseCtx,
      gptwebUtmsRaw: enc(utms),
      searchParams: new URLSearchParams('utm_source=override'),
    });
    expect(first.landing_page).toBe('/?utm_source=yandex_direct');
    expect(first.referrer).toBe('https://yandex.ru/');
    expect(first.seen_at).toBe(utms.seenAt);
    expect(first.utm_source).toBe('override');
    expect(first.utm_medium).toBe('cpc');
    expect(first.ym_client_id).toBe('from-utms');
    expect(last.landing_page).toBe(baseCtx.requestedPath);
    expect(last.seen_at).toBe(NOW.toISOString());
  });

  it('falls back to the _ym_uid cookie for the Metrika id', () => {
    const { first, last } = buildAttributionPayloads({
      ...baseCtx,
      wgAttrRaw: enc({ ...WG, ym: undefined }),
      ymUidRaw: '1700000000123456789',
    });
    expect(first.ym_client_id).toBe('1700000000123456789');
    expect(last.ym_client_id).toBe('1700000000123456789');
  });

  it('keeps an empty wg referrer as "" (direct) instead of the app referer', () => {
    const { first } = buildAttributionPayloads({ ...baseCtx, wgAttrRaw: enc({ ...WG, ref: '' }) });
    expect(first.referrer).toBe('');
    expect(
      computeAttributionRow({ firstCookie: first, lastCookie: null, userId: 'u2' }),
    ).toMatchObject({ firstReferrer: null, firstUtmSource: 'direct' });
  });

  it(`clamps landing_page / referrer to ${ATTR_URL_MAX_LEN} chars in both payloads (review #3)`, () => {
    const long = 'x'.repeat(600);
    const { first, last } = buildAttributionPayloads({
      now: NOW,
      referer: `https://ref.example/${long}`,
      requestedPath: `/very/long/${long}`,
      searchParams: new URLSearchParams(''),
      wgAttrRaw: enc({ lp: `/blog/${long}`, ref: `https://yandex.ru/${long}`, ts: WG.ts }),
    });
    for (const p of [first, last]) {
      expect(p.landing_page?.length).toBe(ATTR_URL_MAX_LEN);
      expect(p.referrer?.length).toBe(ATTR_URL_MAX_LEN);
    }
    expect(first.landing_page?.startsWith('/blog/')).toBe(true);
    expect(last.landing_page?.startsWith('/very/long/')).toBe(true);
  });
});

describe('utmsBelongToFirstTouch', () => {
  const wg = parseWgAttr(enc(WG))!;
  it('treats a utm cookie within the tolerance window (or older) as the same first visit', () => {
    expect(utmsBelongToFirstTouch(wg, { seenAt: WG.ts })).toBe(true);
    expect(utmsBelongToFirstTouch(wg, { seenAt: '2026-09-13T09:00:00.000Z' })).toBe(true);
    expect(
      utmsBelongToFirstTouch(wg, {
        seenAt: new Date(Date.parse(WG.ts) + SAME_VISIT_TOLERANCE_MS).toISOString(),
      }),
    ).toBe(true);
  });
  it('treats a clearly later utm cookie as a separate visit', () => {
    expect(
      utmsBelongToFirstTouch(wg, {
        seenAt: new Date(Date.parse(WG.ts) + SAME_VISIT_TOLERANCE_MS + 1).toISOString(),
      }),
    ).toBe(false);
  });
  it('keeps legacy behaviour when either timestamp is missing/invalid', () => {
    expect(utmsBelongToFirstTouch(wg, {})).toBe(true);
    expect(utmsBelongToFirstTouch({ ...wg, ts: null }, { seenAt: WG.ts })).toBe(true);
    expect(utmsBelongToFirstTouch(wg, { seenAt: 'nope' })).toBe(true);
  });
});

describe('parseLandingUtms', () => {
  it('parses an encoded cookie and rejects garbage / empty objects', () => {
    expect(parseLandingUtms(enc({ utm_source: 'x' }))).toEqual({ utm_source: 'x' });
    expect(parseLandingUtms(enc({}))).toBeNull();
    expect(parseLandingUtms(enc([1]))).toBeNull();
    expect(parseLandingUtms('%7Bbroken')).toBeNull();
    expect(parseLandingUtms(null)).toBeNull();
  });
});
