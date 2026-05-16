import { userAttribution } from '@/database/schemas/analytics';
import { type LobeChatDatabase } from '@/database/type';

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
  userId: string;
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
    return {
      [`${prefix}UtmSource`]: cookie.utm_source,
      [`${prefix}UtmMedium`]: cookie.utm_medium,
      [`${prefix}UtmCampaign`]: cookie.utm_campaign,
      [`${prefix}UtmContent`]: cookie.utm_content,
      [`${prefix}Referrer`]: cookie.referrer,
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
    registeredAt: new Date(),
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
