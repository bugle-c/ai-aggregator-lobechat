/**
 * Pure builder for the two app-side attribution cookies the proxy middleware
 * writes (`utm_attribution_first`, `utm_attribution_last`) and the signup hook
 * reads (src/libs/better-auth/define-config.ts → writeAttribution).
 *
 * Inputs are the landing's cookies (`wg_attr`, `_gptweb_utms`), Metrika's own
 * `_ym_uid`, and the current request. Kept free of Next/DB imports so it runs
 * on the edge and is unit-testable without a NextRequest.
 *
 * FIRST touch = the earliest evidence we have, which for anyone who came
 * through gptweb.ru is the landing's `wg_attr` (first page, referrer, ts).
 * LAST touch = the current request, always.
 */
import { parseWgAttr, type WgAttr } from '@/server/modules/analytics/wgAttr';
import { type AttributionCookie } from '@/server/modules/analytics/writeAttribution';

/** Landing-side `_gptweb_utms` (landing/lib/utm-capture.ts). */
export interface LandingUtmsCookie {
  analyticsIds?: Record<string, string>;
  gaClientId?: string | null;
  landingPage?: string | null;
  referrer?: string | null;
  roistatVisit?: string | null;
  seenAt?: string;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_medium?: string | null;
  utm_source?: string | null;
  ymClientId?: string | null;
}

export interface AttributionRequestContext {
  /** Raw `_gptweb_utms` cookie value (URI-encoded JSON) or null. */
  gptwebUtmsRaw?: string | null;
  now?: Date;
  /** Request `Referer` header. */
  referer: string | null;
  /** pathname+search as the user requested it (BEFORE the locale rewrite). */
  requestedPath: string;
  searchParams: URLSearchParams;
  /** Raw `wg_attr` cookie value or null. */
  wgAttrRaw?: string | null;
  /** Metrika's own `_ym_uid` cookie (set on .gptweb.ru) or null. */
  ymUidRaw?: string | null;
}

export interface AttributionPayloads {
  first: AttributionCookie;
  hasUtmInUrl: boolean;
  last: AttributionCookie;
}

/** Cookie-size guard: landing page / referrer are clamped to this. */
export const ATTR_URL_MAX_LEN = 200;

/**
 * `_gptweb_utms` and `wg_attr` are written by the same landing effect on the
 * same page view, so their timestamps differ by milliseconds. Only a utm
 * cookie stamped clearly LATER than `wg_attr` is a separate, later visit.
 */
export const SAME_VISIT_TOLERANCE_MS = 5000;

export const clampUrl = (s: string | null | undefined): string | null => {
  if (s === null || s === undefined) return null;
  return s.length > ATTR_URL_MAX_LEN ? s.slice(0, ATTR_URL_MAX_LEN) : s;
};

export function parseLandingUtms(raw: string | null | undefined): LandingUtmsCookie | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return Object.keys(parsed).length > 0 ? (parsed as LandingUtmsCookie) : null;
  } catch {
    return null;
  }
}

const parseTime = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

/**
 * Is the landing utm cookie part of the SAME visit as `wg_attr` (or older)?
 * If it was stamped clearly later, the first touch was organic and the utm
 * belongs to a later visit only.
 */
export function utmsBelongToFirstTouch(wg: WgAttr, utms: LandingUtmsCookie): boolean {
  const wgTime = parseTime(wg.ts);
  const utmsTime = parseTime(utms.seenAt);
  if (wgTime === null || utmsTime === null) return true; // can't order — keep legacy behaviour
  return utmsTime <= wgTime + SAME_VISIT_TOLERANCE_MS;
}

export function buildAttributionPayloads(ctx: AttributionRequestContext): AttributionPayloads {
  const now = ctx.now ?? new Date();
  const wg = parseWgAttr(ctx.wgAttrRaw);
  const landing = parseLandingUtms(ctx.gptwebUtmsRaw);
  const sp = ctx.searchParams;

  const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as const;
  const hasUtmInUrl = utmKeys.some((k) => sp.has(k));
  const urlUtm = (k: (typeof utmKeys)[number]) => sp.get(k) ?? landing?.[k] ?? null;

  const ymClientId =
    wg?.ym ?? landing?.ymClientId ?? (ctx.ymUidRaw ? ctx.ymUidRaw.trim() || null : null);

  const sharedIds = {
    analytics_ids: landing?.analyticsIds ?? null,
    ga_client_id: landing?.gaClientId ?? null,
    roistat_visit: landing?.roistatVisit ?? null,
    ym_client_id: ymClientId,
  };

  // ---- LAST touch: this request, no landing-side substitution ---------------
  const last: AttributionCookie = {
    landing_page: clampUrl(ctx.requestedPath),
    referrer: clampUrl(ctx.referer),
    seen_at: now.toISOString(),
    utm_campaign: urlUtm('utm_campaign'),
    utm_content: urlUtm('utm_content'),
    utm_medium: urlUtm('utm_medium'),
    utm_source: urlUtm('utm_source'),
    ...sharedIds,
  };

  // ---- FIRST touch ----------------------------------------------------------
  let first: AttributionCookie;
  if (wg) {
    // The landing saw this visitor first. Its utm cookie counts only when it
    // was stamped on that same first visit; utm params on THIS request are by
    // definition later (TrackedLink adds utm_source=landing to every CTA), so
    // they must not masquerade as first touch. With utm_* null the signup
    // writer infers the source from `referrer` (organic / direct / referral).
    const utmFromFirstVisit = landing && utmsBelongToFirstTouch(wg, landing) ? landing : null;
    first = {
      landing_page: clampUrl(wg.lp ?? landing?.landingPage ?? ctx.requestedPath),
      referrer: clampUrl(wg.ref ?? landing?.referrer ?? ctx.referer),
      seen_at: wg.ts ?? landing?.seenAt ?? now.toISOString(),
      utm_campaign: utmFromFirstVisit?.utm_campaign ?? null,
      utm_content: utmFromFirstVisit?.utm_content ?? null,
      utm_medium: utmFromFirstVisit?.utm_medium ?? null,
      utm_source: utmFromFirstVisit?.utm_source ?? null,
      ...sharedIds,
    };
  } else {
    // Legacy path (no wg_attr): landing utm cookie, else this request.
    first = {
      landing_page: clampUrl(landing?.landingPage ?? ctx.requestedPath),
      referrer: clampUrl(landing?.referrer ?? ctx.referer),
      seen_at: landing?.seenAt ?? now.toISOString(),
      utm_campaign: urlUtm('utm_campaign'),
      utm_content: urlUtm('utm_content'),
      utm_medium: urlUtm('utm_medium'),
      utm_source: urlUtm('utm_source'),
      ...sharedIds,
    };
  }

  return { first, hasUtmInUrl, last };
}
