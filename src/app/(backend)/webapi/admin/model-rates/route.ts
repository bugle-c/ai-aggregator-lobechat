// src/app/(backend)/webapi/admin/model-rates/route.ts
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { TIER_DAILY_CAPS } from '@/server/modules/billing/checkUsageLimit';
import { getTierMultiplierForRate } from '@/server/modules/billing/compute-cost';
import { CREDIT_VALUE_RUB, USD_TO_RUB } from '@/server/modules/billing/model-rates';
import {
  classifyModelTierAsync,
  getRequiredPlanForModelAsync,
  invalidateRatesCache,
  PLAN_MAX_TIER,
} from '@/server/modules/billing/model-tiers';
import { fetchAllRates, fetchRate } from '@/server/services/billing/rates-source';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function checkAuth(request: NextRequest): NextResponse | null {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

const ALLOWED_FIELDS = new Set([
  'model_id',
  'provider',
  'pricing_unit',
  'input_per_1m',
  'output_per_1m',
  'per_unit',
  'markup',
  'tier_override',
  'is_active',
  'notes',
]);

function sanitizeBody(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (ALLOWED_FIELDS.has(k)) out[k] = v;
  }
  out.updated_at = new Date().toISOString();
  return out;
}

async function supabaseCall(
  method: 'POST' | 'PATCH' | 'DELETE',
  query: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/model_rates?${query}`, {
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Accept-Profile': 'ai_aggregator',
      'Content-Profile': 'ai_aggregator',
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function GET(request: NextRequest) {
  const err = checkAuth(request);
  if (err) return err;

  const rates = await fetchAllRates();
  const enriched = await Promise.all(
    rates.map(async (r) => ({
      ...r,
      id: r.modelId, // admin UI reads `m.id`; keep alias alongside camelCase modelId
      tier: await classifyModelTierAsync(r.modelId),
      tierMultiplier: getTierMultiplierForRate(r),
      requiredPlan: await getRequiredPlanForModelAsync(r.modelId),
    })),
  );

  const defaultRate = await fetchRate('__default__');
  return NextResponse.json({
    models: enriched,
    defaultRate: defaultRate
      ? {
          inputPer1M: defaultRate.inputPer1M,
          outputPer1M: defaultRate.outputPer1M,
          tier: await classifyModelTierAsync('__default__'),
        }
      : null,
    creditValueRub: CREDIT_VALUE_RUB,
    usdToRub: USD_TO_RUB,
    planMaxTier: PLAN_MAX_TIER,
    tierDailyCaps: TIER_DAILY_CAPS,
    counts: {
      total: enriched.length,
      byTier: enriched.reduce(
        (acc, m) => {
          acc[m.tier] = (acc[m.tier] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      ),
    },
  });
}

export async function POST(request: NextRequest) {
  const err = checkAuth(request);
  if (err) return err;
  const body = (await request.json()) as Record<string, unknown>;
  const res = await supabaseCall('POST', '', sanitizeBody(body));
  if (!res.ok) return NextResponse.json({ error: await res.text() }, { status: res.status });
  invalidateRatesCache();
  return NextResponse.json(await res.json(), { status: 201 });
}

export async function PUT(request: NextRequest) {
  const err = checkAuth(request);
  if (err) return err;
  const body = (await request.json()) as Record<string, unknown>;
  const modelId = body.model_id as string;
  if (!modelId) return NextResponse.json({ error: 'model_id required' }, { status: 400 });
  const res = await supabaseCall(
    'PATCH',
    `model_id=eq.${encodeURIComponent(modelId)}`,
    sanitizeBody(body),
  );
  if (!res.ok) return NextResponse.json({ error: await res.text() }, { status: res.status });
  invalidateRatesCache();
  return NextResponse.json(await res.json());
}

export async function DELETE(request: NextRequest) {
  const err = checkAuth(request);
  if (err) return err;
  const { searchParams } = request.nextUrl;
  const modelId = searchParams.get('model_id');
  if (!modelId) return NextResponse.json({ error: 'model_id required' }, { status: 400 });
  if (modelId === '__default__') {
    return NextResponse.json({ error: '__default__ is protected' }, { status: 400 });
  }
  const res = await supabaseCall('DELETE', `model_id=eq.${encodeURIComponent(modelId)}`);
  if (!res.ok) return NextResponse.json({ error: await res.text() }, { status: res.status });
  invalidateRatesCache();
  return NextResponse.json({ success: true });
}
