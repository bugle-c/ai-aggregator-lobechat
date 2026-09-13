import { userAttribution } from '@/database/schemas/analytics';
import { type LobeChatDatabase } from '@/database/type';

import { type WgAttr } from './wgAttr';

export interface AttributionCookie {
  analytics_ids?: Record<string, string> | null;
  ga_client_id?: string | null;
  landing_page: string | null;
  referrer: string | null;
  roistat_visit?: string | null;
  seen_at: string; // ISO
  utm_campaign: string | null;
  utm_content: string | null;
  utm_medium: string | null;
  utm_source: string | null;
  ym_client_id?: string | null;
}

export interface ComputeAttributionInput {
  firstCookie: AttributionCookie | null;
  lastCookie: AttributionCookie | null;
  rawReferrer?: string | null;
  /**
   * When the row is written later than the account was created (backfill for
   * users created outside better-auth, e.g. by the Telegram bot) pass the real
   * creation time so cohorts stay aligned with `users.created_at`.
   */
  registeredAt?: Date;
  userId: string;
}

const parseTime = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

/**
 * Merge the landing's `wg_attr` first-touch cookie into the app-side
 * `utm_attribution_first` cookie. First touch wins: whichever of the two was
 * captured EARLIER supplies landing page / referrer / seen_at; the other only
 * fills gaps. The Metrika client id is an identity, not a touch — take it from
 * whichever cookie has it. UTM fields are never touched here (they come from
 * the URL / `_gptweb_utms` and are handled by the middleware).
 *
 * Why: before `wg_attr` existed the app cookie was written from the already
 * rewritten request path (`/ru-RU__0`) with an origin-only referer, so for
 * organic blog visitors it holds nothing usable. `wg_attr` carries the real
 * first page on gptweb.ru.
 */
export function applyWgAttr(
  cookie: AttributionCookie | null,
  wg: WgAttr | null,
): AttributionCookie | null {
  if (!wg) return cookie;

  if (!cookie) {
    return {
      landing_page: wg.lp,
      referrer: wg.ref,
      seen_at: wg.ts ?? new Date().toISOString(),
      utm_campaign: null,
      utm_content: null,
      utm_medium: null,
      utm_source: null,
      ym_client_id: wg.ym,
    };
  }

  const cookieTime = parseTime(cookie.seen_at);
  const wgTime = parseTime(wg.ts);
  // Unknown timestamps count as "not earlier" than a known one; two unknowns
  // let the landing cookie win (it is upstream of the app by construction).
  const wgIsFirst = cookieTime === null ? true : wgTime === null ? false : wgTime <= cookieTime;

  const pick = (wgValue: string | null, cookieValue: string | null) =>
    wgIsFirst ? (wgValue ?? cookieValue) : (cookieValue ?? wgValue);

  return {
    ...cookie,
    landing_page: pick(wg.lp, cookie.landing_page),
    referrer: pick(wg.ref, cookie.referrer),
    seen_at: wgIsFirst && wg.ts ? wg.ts : cookie.seen_at,
    ym_client_id: cookie.ym_client_id ?? wg.ym ?? null,
  };
}

export interface AttributionRow {
  firstAnalyticsIds: Record<string, string> | null;
  firstGaClientId: string | null;
  firstLandingPage: string | null;
  firstReferrer: string | null;
  firstRoistatVisit: string | null;
  firstSeenAt: Date;
  firstUtmCampaign: string | null;
  firstUtmContent: string | null;
  firstUtmMedium: string | null;
  firstUtmSource: string | null;
  firstYmClientId: string | null;
  lastAnalyticsIds: Record<string, string> | null;
  lastGaClientId: string | null;
  lastLandingPage: string | null;
  lastReferrer: string | null;
  lastRoistatVisit: string | null;
  lastSeenAt: Date;
  lastUtmCampaign: string | null;
  lastUtmContent: string | null;
  lastUtmMedium: string | null;
  lastUtmSource: string | null;
  lastYmClientId: string | null;
  registeredAt: Date;
  userId: string;
}

const SEARCH_ENGINES = [
  { match: /(^|\.)yandex\./i, source: 'yandex' },
  { match: /(^|\.)google\./i, source: 'google' },
  { match: /(^|\.)bing\./i, source: 'bing' },
  { match: /(^|\.)duckduckgo\./i, source: 'duckduckgo' },
  { match: /(^|\.)yahoo\./i, source: 'yahoo' },
];

export function inferSourceFromReferrer(referrer: string | null): {
  source: string;
  medium: string;
} {
  if (!referrer) return { source: 'direct', medium: 'none' };
  let hostname: string;
  try {
    hostname = new URL(referrer).hostname.toLowerCase();
  } catch {
    return { source: 'direct', medium: 'none' };
  }

  for (const eng of SEARCH_ENGINES) {
    if (eng.match.test(hostname)) {
      return { source: eng.source, medium: 'organic_search' };
    }
  }

  return { source: hostname.replace(/^www\./, ''), medium: 'referral' };
}

function touchToFields(
  prefix: 'first' | 'last',
  cookie: AttributionCookie | null,
  rawReferrer: string | null | undefined,
) {
  if (cookie) {
    // Middleware writes utm_attribution_first on every first visit even when
    // there are no UTM params (to preserve the first-visit referrer + landing
    // page). If the cookie has no utm_source, infer from the cookie's own
    // referrer — that's the FIRST-touch referrer, far more accurate than
    // rawReferrer (which at signup time is always internal /signin).
    const inferred = cookie.utm_source
      ? null
      : inferSourceFromReferrer(cookie.referrer ?? rawReferrer ?? null);
    return {
      [`${prefix}UtmSource`]: cookie.utm_source ?? inferred?.source ?? null,
      [`${prefix}UtmMedium`]: cookie.utm_medium ?? inferred?.medium ?? null,
      [`${prefix}UtmCampaign`]: cookie.utm_campaign,
      [`${prefix}UtmContent`]: cookie.utm_content,
      // '' = captured as a direct visit (see WgAttr.ref) → store as NULL.
      [`${prefix}Referrer`]: cookie.referrer || null,
      [`${prefix}LandingPage`]: cookie.landing_page,
      [`${prefix}SeenAt`]: new Date(cookie.seen_at),
      [`${prefix}YmClientId`]: cookie.ym_client_id ?? null,
      [`${prefix}GaClientId`]: cookie.ga_client_id ?? null,
      [`${prefix}RoistatVisit`]: cookie.roistat_visit ?? null,
      [`${prefix}AnalyticsIds`]: cookie.analytics_ids ?? null,
    } as const;
  }
  const inferred = inferSourceFromReferrer(rawReferrer ?? null);
  return {
    [`${prefix}UtmSource`]: inferred.source,
    [`${prefix}UtmMedium`]: inferred.medium,
    [`${prefix}UtmCampaign`]: null,
    [`${prefix}UtmContent`]: null,
    [`${prefix}Referrer`]: rawReferrer || null,
    [`${prefix}LandingPage`]: null,
    [`${prefix}SeenAt`]: new Date(),
    [`${prefix}YmClientId`]: null,
    [`${prefix}GaClientId`]: null,
    [`${prefix}RoistatVisit`]: null,
    [`${prefix}AnalyticsIds`]: null,
  } as const;
}

export function computeAttributionRow(input: ComputeAttributionInput): AttributionRow {
  const first = touchToFields('first', input.firstCookie, input.rawReferrer);
  const last = touchToFields('last', input.lastCookie ?? input.firstCookie, input.rawReferrer);
  return {
    userId: input.userId,
    ...first,
    ...last,
    registeredAt: input.registeredAt ?? new Date(),
  } as AttributionRow;
}

export async function writeAttribution(
  db: LobeChatDatabase,
  input: ComputeAttributionInput,
): Promise<void> {
  try {
    const row = computeAttributionRow(input);
    await db.insert(userAttribution).values(row).onConflictDoNothing();
  } catch (error) {
    console.error('[analytics] writeAttribution error:', error);
  }
}
