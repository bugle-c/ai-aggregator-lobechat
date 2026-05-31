/**
 * Hourly WaveSpeed unit-price sync.
 *
 * Pulls actual per-model unit prices from WaveSpeed's
 * `POST /api/v3/user/usage_stats?per_model_usage=true` endpoint
 * (= the "real invoice" view that their dashboard shows) and rectifies
 * `ai_aggregator.model_rates.per_unit` rows whose stored cost diverged
 * from reality by more than UPDATE_THRESHOLD_PCT.
 *
 * Why this exists: our pre-2026-05-31 model_rates were seeded from a
 * one-shot reading of WaveSpeed pricing docs and never re-synced. By
 * the time the operator noticed real margins were wrong, several
 * models had drifted (e.g. Veo 3.1 Fast at $0.12/sec assumption
 * vs $1.20/video actual = 3.2× overcharge to ourselves on cost
 * estimates → distorted margin reporting).
 *
 * Sync semantics:
 *   - Pull last 30 days of usage (covers any model used at least once).
 *   - `unit_price` returned by WaveSpeed is the AVERAGE cost across the
 *     period — for models with parameter-dependent formulas (Veo, Kling
 *     with duration/resolution multipliers) this is a weighted mean,
 *     not a per-request truth. Good enough for cost reporting; for
 *     per-request precision we'd need to evaluate WS's JSONata formula
 *     against each request's actual params (Phase P1, not done here).
 *   - When a model exists in `model_rates` but isn't in the WaveSpeed
 *     response (= no usage in 30 days), we leave it alone — no signal.
 *   - When a model is returned by WaveSpeed but missing in
 *     `model_rates`, we LOG it (operator should add a row in admin).
 *
 * Triggered from host cron — see tasks/cron/sync-wavespeed-rates-host.cron.
 *
 * Auth: Bearer CRON_SECRET header.
 */
import { invalidateRatesCache } from '@/server/modules/billing/model-tiers';
import { sendAlert } from '@/server/services/alerts';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const WAVESPEED_API_KEY = process.env.WAVESPEED_API_KEY;
const WAVESPEED_API_URL = 'https://api.wavespeed.ai/api/v3/user/usage_stats';

/**
 * Only sync when the divergence is meaningful — small floating-point
 * fluctuations from formula-rounding shouldn't churn the table or
 * flood the Telegram alert.
 */
const UPDATE_THRESHOLD_PCT = 10;

/** Days back to query WaveSpeed for. 30 = "almost certainly hit any
 *  active model at least once" without flooding the request. */
const LOOKBACK_DAYS = 30;

interface WaveSpeedUsageRow {
  last_used_date: string;
  model_type: string;
  model_uuid: string;
  total_cost: number;
  total_count: number;
  unit_price: number;
}

interface WaveSpeedUsageResponse {
  code: number;
  data?: {
    per_model_usage?: WaveSpeedUsageRow[];
    summary?: { success_requests: number; total_cost: number; total_requests: number };
  };
  message: string;
}

interface ExistingRate {
  id: number;
  is_active: boolean;
  markup: number | string | null;
  model_id: string;
  per_unit: number | string | null;
  pricing_unit: 'tokens' | 'image' | 'second';
}

interface UpdateResult {
  modelId: string;
  newPerUnit: number;
  oldPerUnit: number;
  pctDiff: number;
}

export async function POST(req: Request) {
  // Auth
  const auth = req.headers.get('authorization');
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (!WAVESPEED_API_KEY) {
    return Response.json({ error: 'WAVESPEED_API_KEY not configured' }, { status: 500 });
  }

  const startedAt = Date.now();

  // 1) Fetch WaveSpeed actual usage
  const startDate = isoDateDaysAgo(LOOKBACK_DAYS);
  const endDate = isoDateDaysAgo(0);

  let wsResponse: WaveSpeedUsageResponse;
  try {
    const r = await fetch(WAVESPEED_API_URL, {
      body: JSON.stringify({
        end_date: endDate,
        per_model_usage: true,
        start_date: startDate,
      }),
      headers: {
        'Authorization': `Bearer ${WAVESPEED_API_KEY}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
    if (!r.ok) {
      const text = await r.text();
      return Response.json(
        { error: `WaveSpeed API ${r.status}: ${text.slice(0, 200)}` },
        { status: 502 },
      );
    }
    wsResponse = (await r.json()) as WaveSpeedUsageResponse;
  } catch (err) {
    return Response.json(
      { error: `WaveSpeed fetch failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }

  if (wsResponse.code !== 200 || !wsResponse.data?.per_model_usage) {
    return Response.json(
      { error: `Unexpected WaveSpeed response: code=${wsResponse.code} msg=${wsResponse.message}` },
      { status: 502 },
    );
  }

  const wsRows = wsResponse.data.per_model_usage;
  if (wsRows.length === 0) {
    return Response.json({
      note: 'No WaveSpeed usage in the lookback window — nothing to sync.',
      ok: true,
      windowDays: LOOKBACK_DAYS,
    });
  }

  // 2) Fetch existing wavespeed rows from Supabase model_rates
  let existing: ExistingRate[];
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/model_rates?provider=eq.wavespeed&select=id,model_id,per_unit,markup,pricing_unit,is_active`,
      {
        headers: {
          'Accept-Profile': 'ai_aggregator',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
      },
    );
    if (!r.ok) {
      const text = await r.text();
      return Response.json(
        { error: `Supabase fetch ${r.status}: ${text.slice(0, 200)}` },
        { status: 500 },
      );
    }
    existing = (await r.json()) as ExistingRate[];
  } catch (err) {
    return Response.json(
      { error: `Supabase fetch failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  const existingByModelId = new Map(existing.map((row) => [row.model_id, row]));

  // 3) Diff
  const updates: UpdateResult[] = [];
  const missing: WaveSpeedUsageRow[] = [];
  const inSync: string[] = [];
  const errors: { modelId: string; reason: string }[] = [];

  for (const wsRow of wsRows) {
    const row = existingByModelId.get(wsRow.model_uuid);
    if (!row) {
      missing.push(wsRow);
      continue;
    }
    const oldPerUnit = Number(row.per_unit ?? 0);
    const newPerUnit = wsRow.unit_price;
    if (oldPerUnit === 0) {
      // Old was zero → any nonzero is by definition a 100% jump. Skip
      // silently so manually-zeroed rates (free models) stay zero.
      inSync.push(wsRow.model_uuid);
      continue;
    }
    const pctDiff = Math.abs((newPerUnit - oldPerUnit) / oldPerUnit) * 100;
    if (pctDiff < UPDATE_THRESHOLD_PCT) {
      inSync.push(wsRow.model_uuid);
      continue;
    }

    // 4) Write update
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/model_rates?id=eq.${row.id}`, {
        body: JSON.stringify({
          notes: `Auto-synced from WaveSpeed usage_stats ${new Date().toISOString().slice(0, 10)} — was $${oldPerUnit.toFixed(4)}, now $${newPerUnit.toFixed(4)} (${pctDiff.toFixed(1)}% drift)`,
          per_unit: newPerUnit,
          updated_at: new Date().toISOString(),
        }),
        headers: {
          'Accept-Profile': 'ai_aggregator',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Profile': 'ai_aggregator',
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        method: 'PATCH',
      });
      if (!r.ok) {
        const text = await r.text();
        errors.push({
          modelId: wsRow.model_uuid,
          reason: `PATCH ${r.status}: ${text.slice(0, 200)}`,
        });
        continue;
      }
      updates.push({
        modelId: wsRow.model_uuid,
        newPerUnit,
        oldPerUnit,
        pctDiff,
      });
    } catch (err) {
      errors.push({
        modelId: wsRow.model_uuid,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 5) Invalidate cache so the new prices take effect on the next request.
  if (updates.length > 0) {
    invalidateRatesCache();
  }

  // 6) Telegram summary — only if something happened.
  if (updates.length > 0 || missing.length > 0 || errors.length > 0) {
    const bodyLines: string[] = [];

    if (updates.length > 0) {
      bodyLines.push(`✔ updated ${updates.length} prices:`);
      for (const u of updates.slice(0, 10)) {
        bodyLines.push(
          `  ${u.modelId}: $${u.oldPerUnit.toFixed(4)} → $${u.newPerUnit.toFixed(4)} (${u.pctDiff.toFixed(0)}% drift)`,
        );
      }
      if (updates.length > 10) bodyLines.push(`  …and ${updates.length - 10} more`);
    }

    if (missing.length > 0) {
      bodyLines.push('');
      bodyLines.push(`⚠ ${missing.length} WaveSpeed models WITHOUT model_rates row:`);
      for (const m of missing.slice(0, 10)) {
        bodyLines.push(`  ${m.model_uuid} (avg $${m.unit_price.toFixed(4)})`);
      }
      if (missing.length > 10) bodyLines.push(`  …and ${missing.length - 10} more`);
    }

    if (errors.length > 0) {
      bodyLines.push('');
      bodyLines.push(`✖ ${errors.length} failed to write:`);
      for (const e of errors) bodyLines.push(`  ${e.modelId}: ${e.reason}`);
    }

    await sendAlert({
      body: bodyLines.join('\n'),
      severity: errors.length > 0 ? 'warning' : 'info',
      title: `WaveSpeed rate sync: ${updates.length} updated, ${missing.length} missing, ${errors.length} errors`,
    });
  }

  return Response.json({
    durationMs: Date.now() - startedAt,
    errors,
    inSync: inSync.length,
    missing: missing.length,
    ok: true,
    updates,
    windowDays: LOOKBACK_DAYS,
  });
}

function isoDateDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}
