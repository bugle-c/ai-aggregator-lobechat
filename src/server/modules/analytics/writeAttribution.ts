import { userAttribution } from '@/database/schemas/analytics';
import { type LobeChatDatabase } from '@/database/type';

export interface AttributionCookie {
  landing_page: string | null;
  referrer: string | null;
  seen_at: string; // ISO
  utm_campaign: string | null;
  utm_content: string | null;
  utm_medium: string | null;
  utm_source: string | null;
}

export interface ComputeAttributionInput {
  firstCookie: AttributionCookie | null;
  lastCookie: AttributionCookie | null;
  rawReferrer?: string | null;
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
  } as const;
}

export function computeAttributionRow(input: ComputeAttributionInput) {
  const first = touchToFields('first', input.firstCookie, input.rawReferrer);
  const last = touchToFields('last', input.lastCookie ?? input.firstCookie, input.rawReferrer);
  return {
    userId: input.userId,
    ...first,
    ...last,
    registeredAt: new Date(),
  };
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
