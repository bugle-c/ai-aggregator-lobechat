/**
 * Daily provider-invoice sync.
 *
 * Writes one `ai_aggregator.manual_expenses` row per (yesterday, provider)
 * so `/admin/finance/api-costs` has an `invoiced_usd` column to compare
 * `booked_usd` against — without the operator manually copying figures
 * from each provider's dashboard.
 *
 * Sources:
 *   - WaveSpeed: `POST /api/v3/user/usage_stats` with start=end=yesterday.
 *     `summary.total_cost` is yesterday's billed amount in USD (the same
 *     number their dashboard invoice page shows).
 *   - OpenRouter: every successful chat response already includes
 *     `usage.cost`, which we persist as `usage_logs.cost_usd` for rows
 *     bucketed to openrouter. Sum it for yesterday — that IS the invoice.
 *     No external call needed.
 *
 * Both providers UPSERT a single `manual_expenses` row with `source='auto'`,
 * keyed on (date, provider) via a partial unique index. Re-running the cron
 * for the same date overwrites the row (handy for backfill or when WaveSpeed
 * eventually settles a delayed-billing entry).
 *
 * Auth: Bearer CRON_SECRET header.
 *
 * Triggered from host cron — see tasks/cron/sync-invoices-host.cron.
 */
import { and, gte, lt, sql as drizzleSql } from 'drizzle-orm';

import { usageLogs } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { sendAlert } from '@/server/services/alerts';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const WAVESPEED_API_KEY = process.env.WAVESPEED_API_KEY;
const WAVESPEED_API_URL = 'https://api.wavespeed.ai/api/v3/user/usage_stats';

const USD_TO_RUB = Number.parseFloat(process.env.USD_TO_RUB ?? '90');

/**
 * Returns YYYY-MM-DD for `daysAgo` days back in UTC (00:00 boundary).
 * UTC is intentional — matches how WaveSpeed reports its dates.
 */
function isoDate(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

interface WaveSpeedDailyUsage {
  amount: number;
  count: number;
  date: string;
  models?: Array<{ amount: number; count: number; model_uuid: string }>;
}

interface WaveSpeedResp {
  code: number;
  data?: {
    daily_usage?: WaveSpeedDailyUsage[];
    per_model_usage?: Array<{
      last_used_date: string;
      model_uuid: string;
      total_cost: number;
      total_count: number;
      unit_price: number;
    }>;
    summary?: { success_requests: number; total_cost: number; total_requests: number };
  };
  message: string;
}

interface ProviderResult {
  amountUsd: number;
  date: string;
  details?: string;
  ok: boolean;
  provider: string;
  reason?: string;
  rowId?: string;
}

export async function POST(req: Request) {
  const auth = req.headers.get('authorization');
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = new URL(req.url);
  // ?date=2026-05-30 → backfill a specific day. Default: yesterday.
  const targetDate = url.searchParams.get('date') ?? isoDate(1);

  const startedAt = Date.now();
  const results: ProviderResult[] = [];

  // ---- A) WaveSpeed ----
  //
  // WaveSpeed's /usage_stats endpoint IGNORES start_date/end_date in the
  // request body and always returns the full history for the API key, with
  // `summary.total_cost` = lifetime spend. The per-date breakdown is inside
  // `data.daily_usage[].date+amount` — that's the only way to get yesterday's
  // real number. So we send one request and look up our `targetDate` in the
  // array (defaulting to $0 if the date isn't present — no activity that day).
  //
  // Also note: `summary.total_cost` covers ONLY this API key. The WaveSpeed
  // dashboard shows the whole account (all keys + UI-initiated test calls),
  // so don't be surprised if those numbers diverge.
  if (WAVESPEED_API_KEY) {
    try {
      const r = await fetch(WAVESPEED_API_URL, {
        body: JSON.stringify({
          end_date: targetDate,
          per_model_usage: true,
          start_date: '2024-01-01',
        }),
        headers: {
          'Authorization': `Bearer ${WAVESPEED_API_KEY}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
      });
      if (!r.ok) {
        const text = await r.text();
        results.push({
          amountUsd: 0,
          date: targetDate,
          ok: false,
          provider: 'wavespeed',
          reason: `WaveSpeed API ${r.status}: ${text.slice(0, 200)}`,
        });
      } else {
        const j = (await r.json()) as WaveSpeedResp;
        const dayBucket = j.data?.daily_usage?.find((b) => b.date === targetDate);
        const dayCost = dayBucket?.amount ?? 0;
        const dayCount = dayBucket?.count ?? 0;
        const upsert = await upsertExpense({
          amountUsd: dayCost,
          date: targetDate,
          description: `WaveSpeed daily (auto): ${dayCount} requests, $${dayCost.toFixed(4)}`,
          provider: 'wavespeed',
        });
        results.push({
          amountUsd: dayCost,
          date: targetDate,
          details: `requests=${dayCount}`,
          ok: upsert.ok,
          provider: 'wavespeed',
          reason: upsert.reason,
          rowId: upsert.rowId,
        });
      }
    } catch (err) {
      results.push({
        amountUsd: 0,
        date: targetDate,
        ok: false,
        provider: 'wavespeed',
        reason: `WaveSpeed fetch: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  } else {
    results.push({
      amountUsd: 0,
      date: targetDate,
      ok: false,
      provider: 'wavespeed',
      reason: 'WAVESPEED_API_KEY not configured',
    });
  }

  // ---- B) OpenRouter (no external call — sum usage_logs.cost_usd for openrouter-bucketed rows) ----
  try {
    const db = await getServerDB();

    // Bucketing logic mirrors webgpt-admin's lib/provider-mapping.ts. Kept
    // inline so this route doesn't pull a cross-repo dependency. WaveSpeed
    // prefixes are excluded; everything left is OpenRouter (the umbrella
    // post-2026-04 chat backend).
    const isWavespeedSql = drizzleSql`(
         ${usageLogs.model} LIKE 'wavespeed-ai/%'
      OR ${usageLogs.model} LIKE 'google/veo%' OR ${usageLogs.model} LIKE 'google/nano-banana%' OR ${usageLogs.model} LIKE 'google/imagen%'
      OR ${usageLogs.model} LIKE 'openai/gpt-image%' OR ${usageLogs.model} LIKE 'openai/sora%' OR ${usageLogs.model} LIKE 'openai/dall-e%'
      OR ${usageLogs.model} LIKE 'bytedance/seedream%' OR ${usageLogs.model} LIKE 'bytedance/seedance%'
      OR ${usageLogs.model} LIKE 'kwaivgi/kling%' OR ${usageLogs.model} LIKE 'alibaba/wan%' OR ${usageLogs.model} LIKE 'alibaba/qwen-image%'
      OR ${usageLogs.model} LIKE 'fal-ai/%' OR ${usageLogs.model} LIKE 'pruna-ai/%' OR ${usageLogs.model} LIKE 'pika/%'
      OR ${usageLogs.model} LIKE 'higgsfield/%' OR ${usageLogs.model} LIKE 'skywork-ai/%' OR ${usageLogs.model} LIKE 'recraft-ai/%'
      OR ${usageLogs.model} LIKE '%/text-to-image%' OR ${usageLogs.model} LIKE '%/text-to-video%' OR ${usageLogs.model} LIKE '%/image-to-video%' OR ${usageLogs.model} LIKE '%/image-to-image%'
    )`;
    // Local Ollama models — non-billable, must not pollute openrouter total.
    const isLocalSql = drizzleSql`(
         ${usageLogs.model} LIKE 'gemma4:%'
      OR ${usageLogs.model} LIKE 'qwen3-coder:%'
      OR ${usageLogs.model} LIKE 'hf.co/TrevorJS/gemma-%'
    )`;
    // Hugging Face proper (non-local hf.co).
    const isHfSql = drizzleSql`(${usageLogs.model} LIKE 'hf.co/%' AND NOT ${isLocalSql})`;

    const dayStart = `${targetDate} 00:00:00+00`;
    const dayEnd = `${targetDate} 23:59:59.999+00`;

    const rows = await db
      .select({
        sum: drizzleSql<number>`COALESCE(SUM(${usageLogs.costUsd}::numeric), 0)::float8`,
      })
      .from(usageLogs)
      .where(
        and(
          gte(usageLogs.createdAt, new Date(dayStart)),
          lt(usageLogs.createdAt, new Date(`${isoDate(0)} 00:00:00+00`)),
          drizzleSql`${usageLogs.createdAt} <= ${dayEnd}::timestamptz`,
          drizzleSql`NOT ${isWavespeedSql}`,
          drizzleSql`NOT ${isHfSql}`,
          drizzleSql`NOT ${isLocalSql}`,
        ),
      );

    const totalCost = rows[0]?.sum ?? 0;
    const upsert = await upsertExpense({
      amountUsd: totalCost,
      date: targetDate,
      description: `OpenRouter daily (auto): sum of usage_logs.cost_usd for non-WS / non-HF / non-local models`,
      provider: 'openrouter',
    });
    results.push({
      amountUsd: totalCost,
      date: targetDate,
      ok: upsert.ok,
      provider: 'openrouter',
      reason: upsert.reason,
      rowId: upsert.rowId,
    });
  } catch (err) {
    results.push({
      amountUsd: 0,
      date: targetDate,
      ok: false,
      provider: 'openrouter',
      reason: `OpenRouter sum: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // ---- Alert summary ----
  const failed = results.filter((r) => !r.ok);
  const succeeded = results.filter((r) => r.ok);
  const totalUsd = results.reduce((acc, r) => acc + (r.ok ? r.amountUsd : 0), 0);

  if (failed.length > 0) {
    await sendAlert({
      body: failed.map((r) => `  ${r.provider}: ${r.reason}`).join('\n'),
      severity: 'warning',
      title: `Invoice sync: ${failed.length}/${results.length} providers failed for ${targetDate}`,
    });
  } else if (totalUsd > 0) {
    // Informational alert with the day's spend — helps operator notice
    // unexpected drift without having to open the admin every morning.
    await sendAlert({
      body:
        succeeded
          .map(
            (r) =>
              `  ${r.provider}: $${r.amountUsd.toFixed(2)}${r.details ? ` (${r.details})` : ''}`,
          )
          .join('\n') +
        `\n\nTotal: $${totalUsd.toFixed(2)} ≈ ${Math.round(totalUsd * USD_TO_RUB)} ₽`,
      severity: 'info',
      title: `Invoice sync: $${totalUsd.toFixed(2)} on ${targetDate}`,
    });
  }

  return Response.json({
    durationMs: Date.now() - startedAt,
    ok: failed.length === 0,
    results,
    targetDate,
    totalUsd,
  });
}

/**
 * UPSERT one row in `manual_expenses` keyed on (date, provider) where
 * source='auto'. Backed by a partial unique index added in the migration
 * that landed alongside this route.
 *
 * amount_rub is stored as an integer (the historical convention in this
 * table — `amount_original` carries the precise USD), so we round on write.
 */
async function upsertExpense(params: {
  amountUsd: number;
  date: string;
  description: string;
  provider: string;
}): Promise<{ ok: boolean; reason?: string; rowId?: string }> {
  try {
    const body = {
      amount_original: params.amountUsd,
      amount_rub: Math.round(params.amountUsd * USD_TO_RUB),
      category: 'api',
      currency_original: 'USD',
      date: params.date,
      description: params.description,
      exchange_rate: USD_TO_RUB,
      provider: params.provider,
      recurring: false,
      source: 'auto',
    };

    // Try INSERT first. If the (date, provider, source=auto) row already
    // exists we'll fall through to PATCH below.
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/manual_expenses`, {
      body: JSON.stringify(body),
      headers: {
        'Accept-Profile': 'ai_aggregator',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Profile': 'ai_aggregator',
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      method: 'POST',
    });

    if (insertRes.ok) {
      const inserted = (await insertRes.json()) as Array<{ id: string }>;
      return { ok: true, rowId: inserted[0]?.id };
    }

    // 409 Conflict → row exists, do PATCH.
    if (insertRes.status === 409) {
      const patchRes = await fetch(
        `${SUPABASE_URL}/rest/v1/manual_expenses?date=eq.${params.date}&provider=eq.${encodeURIComponent(params.provider)}&source=eq.auto`,
        {
          body: JSON.stringify({
            amount_original: params.amountUsd,
            amount_rub: Math.round(params.amountUsd * USD_TO_RUB),
            description: params.description,
            exchange_rate: USD_TO_RUB,
            updated_at: new Date().toISOString(),
          }),
          headers: {
            'Accept-Profile': 'ai_aggregator',
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Profile': 'ai_aggregator',
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          method: 'PATCH',
        },
      );
      if (!patchRes.ok) {
        const text = await patchRes.text();
        return { ok: false, reason: `PATCH ${patchRes.status}: ${text.slice(0, 200)}` };
      }
      const updated = (await patchRes.json()) as Array<{ id: string }>;
      return { ok: true, rowId: updated[0]?.id };
    }

    const text = await insertRes.text();
    return { ok: false, reason: `INSERT ${insertRes.status}: ${text.slice(0, 200)}` };
  } catch (err) {
    return {
      ok: false,
      reason: `upsert: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
