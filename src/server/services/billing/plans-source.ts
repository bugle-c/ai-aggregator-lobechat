/**
 * Plans source of truth lives in Supabase `ai_aggregator.plans`, edited from
 * /admin/finance/plans. Aggregator reads from here (REST) with a short
 * in-memory cache so the hot chat path doesn't hit the network every request.
 */

export interface PlanView {
  id: number;
  slug: string;
  name: string;
  priceRub: number;
  tokenLimit: number;
  dailyCreditLimit: number | null;
  isActive: boolean;
}

interface RawPlanRow {
  id: number;
  slug: string;
  name: string;
  display_name: string | null;
  price_rub: number;
  token_limit: number;
  daily_credit_limit: number | null;
  is_active: boolean;
}

const CACHE_TTL_MS = 60_000;
const SELECT = 'id,slug,name,display_name,price_rub,token_limit,daily_credit_limit,is_active';

let cache: { plans: PlanView[]; expiresAt: number } | null = null;
let inflight: Promise<PlanView[]> | null = null;

function mapRow(row: RawPlanRow): PlanView {
  return {
    id: row.id,
    slug: row.slug,
    name: row.display_name ?? row.name,
    priceRub: row.price_rub,
    tokenLimit: row.token_limit,
    dailyCreditLimit: row.daily_credit_limit,
    isActive: row.is_active,
  };
}

async function loadFromSupabase(): Promise<PlanView[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }
  const res = await fetch(`${url}/rest/v1/plans?select=${SELECT}&order=price_rub.asc`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Accept-Profile': 'ai_aggregator',
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch plans from Supabase: ${res.status} ${await res.text()}`);
  }
  const rows = (await res.json()) as RawPlanRow[];
  return rows.map(mapRow);
}

async function getPlans(): Promise<PlanView[]> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.plans;
  if (inflight) return inflight;

  inflight = loadFromSupabase()
    .then((plans) => {
      cache = { plans, expiresAt: now + CACHE_TTL_MS };
      return plans;
    })
    .catch((err) => {
      // On failure, serve stale cache if any (avoids breaking billing during transient Supabase blips)
      if (cache) {
        console.warn('[plans-source] Supabase fetch failed, serving stale cache:', err);
        return cache.plans;
      }
      throw err;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export async function fetchActivePlans(): Promise<PlanView[]> {
  const all = await getPlans();
  return all.filter((p) => p.isActive);
}

export async function fetchPlanById(id: number): Promise<PlanView | undefined> {
  const all = await getPlans();
  return all.find((p) => p.id === id);
}

export async function fetchPlanBySlug(slug: string): Promise<PlanView | undefined> {
  const all = await getPlans();
  return all.find((p) => p.slug === slug);
}

/** Test / admin utility to force cache reload. */
export function invalidatePlansCache(): void {
  cache = null;
}
