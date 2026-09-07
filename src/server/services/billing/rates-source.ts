/**
 * Model rates source of truth lives in Supabase `ai_aggregator.model_rates`,
 * edited from /admin/finance/models. Aggregator reads from here (REST) with
 * a short in-memory cache so the hot chat path doesn't hit the network every
 * request.
 *
 * Mirrors the plans-source.ts pattern — same TTL, same stale-on-error
 * semantics, same cache invalidation surface.
 */

export type PricingUnit = 'tokens' | 'image' | 'second';
export type TierOverride = 'cheap' | 'mid' | 'high' | 'premium' | null;

export interface RateView {
  inputPer1M: number | null; // null when unit=image|second
  isActive: boolean;
  markup: number;
  /**
   * Per-model explicit markup that REPLACES the tier-derived multiplier when
   * set (e.g. 2.0 = 100% margin regardless of the model's cheap/mid/high tier).
   * Used to expose a "wow-price" hero model — e.g. DeepSeek V4 Flash for the
   * Free tier — without moving it into a lower tier bucket that would also
   * change the plan-visibility gate. NULL = fall through to tier logic.
   */
  markupOverride: number | null;
  modelId: string;
  outputPer1M: number | null;
  perUnit: number | null; // null when unit=tokens
  pricingUnit: PricingUnit;
  provider: string;
  tierOverride: TierOverride;
}

interface RawRateRow {
  input_per_1m: string | null;
  is_active: boolean;
  markup: string;
  markup_override: string | null;
  model_id: string;
  output_per_1m: string | null;
  per_unit: string | null;
  pricing_unit: PricingUnit;
  provider: string;
  tier_override: TierOverride;
}

const CACHE_TTL_MS = 60_000;
const SELECT =
  'model_id,provider,pricing_unit,input_per_1m,output_per_1m,per_unit,markup,markup_override,tier_override,is_active';

let cache: { rates: RateView[]; byId: Map<string, RateView>; expiresAt: number } | null = null;
let inflight: Promise<RateView[]> | null = null;

function mapRow(row: RawRateRow): RateView {
  // Markup defends revenue: real provider cost × markup = what we charge.
  // An admin typo (0, '', 'нет', '0,5' with Russian decimal comma → NaN,
  // negative) would silently disable monetisation. Fall back to 3 (the
  // default markup for the bulk of the catalogue) and log loudly so the
  // mistake is fixable, but the business doesn't bleed in the meantime.
  const rawMarkup = Number(row.markup);
  const markup =
    Number.isFinite(rawMarkup) && rawMarkup > 0
      ? rawMarkup
      : (() => {
          console.error(
            `[rates] invalid markup for ${row.model_id}: ${row.markup} → defaulting to 3 (revenue protection)`,
          );
          return 3;
        })();

  // markup_override: strict — only accept positive finite numbers. Zero and
  // negatives would silently give the model away for free; treat them like
  // NULL (fall back to tier logic) and log.
  let markupOverride: number | null = null;
  if (row.markup_override !== null && row.markup_override !== undefined) {
    const parsed = Number(row.markup_override);
    if (Number.isFinite(parsed) && parsed > 0) {
      markupOverride = parsed;
    } else {
      console.error(
        `[rates] invalid markup_override for ${row.model_id}: ${row.markup_override} → ignoring, falling back to tier multiplier`,
      );
    }
  }

  return {
    modelId: row.model_id,
    provider: row.provider,
    pricingUnit: row.pricing_unit,
    inputPer1M: row.input_per_1m !== null ? Number(row.input_per_1m) : null,
    outputPer1M: row.output_per_1m !== null ? Number(row.output_per_1m) : null,
    perUnit: row.per_unit !== null ? Number(row.per_unit) : null,
    markup,
    markupOverride,
    tierOverride: row.tier_override,
    isActive: row.is_active,
  };
}

async function loadFromSupabase(): Promise<RateView[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }
  const res = await fetch(`${url}/rest/v1/model_rates?select=${SELECT}&is_active=eq.true`, {
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Accept-Profile': 'ai_aggregator',
    },
  });
  if (!res.ok) {
    throw new Error(`model_rates fetch failed: ${res.status} ${await res.text()}`);
  }
  const rows = (await res.json()) as RawRateRow[];
  return rows.map(mapRow);
}

async function getRates(): Promise<RateView[]> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.rates;
  if (inflight) return inflight;

  inflight = loadFromSupabase()
    .then((rates) => {
      const byId = new Map(rates.map((r) => [r.modelId, r]));
      cache = { rates, byId, expiresAt: Date.now() + CACHE_TTL_MS };
      return rates;
    })
    .catch((err) => {
      // On failure, serve stale cache if any (avoids breaking billing during transient Supabase blips)
      if (cache) {
        console.warn('[rates-source] Supabase fetch failed, serving stale cache:', err);
        return cache.rates;
      }
      throw err;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export async function fetchAllRates(): Promise<RateView[]> {
  return getRates();
}

/**
 * Resolve the model rate, tolerating several ID conventions:
 *
 * 1. Exact match (`gpt-5-mini` → row with that exact id).
 * 2. Catalog uses bare ids (`gpt-5-mini`); admin uses prefixed ids
 *    (`openai/gpt-5-mini`). When input is bare, scan cache for any row whose
 *    id ends with `/<input>`.
 * 3. Reverse case — input prefixed but cache has bare. Strip first segment.
 * 4. Light dash↔dot normalisation (`claude-sonnet-4-5-20250929` →
 *    `claude-sonnet-4.5`) so versioned catalog ids match dot-style admin ids.
 * 5. Final fallback: `__default__` row.
 *
 * Without this, the by-provider lock indicator over-locks free users:
 * every chat model whose id doesn't match admin's prefixed convention
 * resolves to `__default__` ($75/1M output → premium) and is gated.
 */
export async function fetchRate(modelId: string): Promise<RateView | undefined> {
  await getRates();
  const byId = cache?.byId;
  if (!byId) return undefined;

  const exact = byId.get(modelId);
  if (exact) return exact;

  if (!modelId.includes('/')) {
    for (const [key, rate] of byId) {
      if (key.endsWith('/' + modelId)) return rate;
    }
  } else {
    const stripped = modelId.split('/').slice(1).join('/');
    const dropPrefix = byId.get(stripped);
    if (dropPrefix) return dropPrefix;
  }

  // dash/dot normalisation — strip trailing date and rewrite version dashes
  const stripDateSuffix = modelId.replace(/-\d{8}$/, '');
  const dotted = stripDateSuffix.replaceAll(/-(\d+)-(\d+)(?=$|-)/g, '-$1.$2');
  if (dotted !== modelId) {
    const dot = byId.get(dotted);
    if (dot) return dot;
    if (!dotted.includes('/')) {
      for (const [key, rate] of byId) {
        if (key.endsWith('/' + dotted)) return rate;
      }
    }
  }

  return byId.get('__default__');
}

/** Test / admin utility to force cache reload. */
export function invalidateRatesCache(): void {
  cache = null;
}
