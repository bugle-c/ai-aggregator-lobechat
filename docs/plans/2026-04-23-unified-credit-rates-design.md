# Unified credit rates with per-model markup — design

**Status:** approved 2026-04-23
**Owners:** aggregator + admin
**Supersedes:** hardcoded `MODEL_RATES` in `src/server/modules/billing/model-rates.ts`, Opus-specific daily cap
**Relates to:** [Pro Max split](2026-04-23-pro-max-split.md) (implicit, no file yet), [Plans source of truth](../../MEMORY.md plans_source_of_truth)

## Goal

Consolidate chat + image + video billing into a single credit currency with a per-model markup that operators can tune through the admin UI without a redeploy. Protect margin on every model (not only Opus), while letting the catalog grow without code changes.

Benchmarks:
- **Chad AI** — single "Chad words" currency, per-model coefficient 0.5x–40x, image/video in same bucket.
- **Higgsfield** — unified credits across image+video, hidden markup, double gate (plan-lock + credit-weight) on flagship models (Sora/Veo).
- **MashaGPT** — token bucket per plan, flat all-model pricing, annual discount 52%.

## Non-goals

- Annual subscription pricing (separate spec, coming later).
- Top-up packs with overage markup (separate spec).
- Public markup page / cents-per-credit transparency (future UX decision).

## Billing formula

```
provider_cost_usd         ← raw price from provider (tokens × rates or per-unit × quantity)
internal_cost_usd         = provider_cost_usd × markup              (markup per model, target 3.0; seeded at 1.0 for continuity — see Risk & rollback)
internal_cost_rub         = internal_cost_usd × USD_TO_RUB          (constant, 100 today)
credits_charged           = ceil(internal_cost_rub / CREDIT_VALUE_RUB)   (1 credit = 0.15 ₽)
```

Two constants stay in code (`USD_TO_RUB`, `CREDIT_VALUE_RUB`) — they're global, rarely change, and a typo is very expensive. Everything model-specific moves to DB.

## Data model

New table `ai_aggregator.model_rates`:

```sql
CREATE TABLE ai_aggregator.model_rates (
  id             serial PRIMARY KEY,
  model_id       text UNIQUE NOT NULL,
  provider       text NOT NULL,                   -- "anthropic", "openai", "google", "x-ai", "fal", "replicate", "openrouter", "unknown"
  pricing_unit   text NOT NULL,                   -- 'tokens' | 'image' | 'second'
  input_per_1m   numeric(10,4),                   -- USD; required when unit='tokens'
  output_per_1m  numeric(10,4),                   -- USD; required when unit='tokens'
  per_unit       numeric(10,4),                   -- USD; required when unit='image' or 'second'
  markup         numeric(5,2) NOT NULL DEFAULT 3.00,
  tier_override  text,                            -- 'cheap'|'mid'|'high'|'premium' — if set, bypasses automatic tier classification
  is_active      boolean NOT NULL DEFAULT true,
  notes          text,                            -- free-form admin note ("Anthropic raised Opus 2025-11")
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (pricing_unit IN ('tokens', 'image', 'second')),
  CHECK (
    (pricing_unit = 'tokens' AND input_per_1m IS NOT NULL AND output_per_1m IS NOT NULL)
    OR (pricing_unit IN ('image', 'second') AND per_unit IS NOT NULL)
  ),
  CHECK (markup > 0)
);

CREATE INDEX model_rates_provider_idx ON ai_aggregator.model_rates(provider);
CREATE INDEX model_rates_pricing_unit_idx ON ai_aggregator.model_rates(pricing_unit);
```

One row is reserved: `model_id = '__default__'` — used as fallback for unknown **chat** models only (never image/video, see Risk & rollback). Seeded at premium-tier rate (tokens mode, $5/$25, markup 1.0). Never delete this row.

## Tier classification

Automatic (when `tier_override` is NULL):

| pricing_unit | metric used for tier | cheap | mid | high | premium |
|---|---|---|---|---|---|
| tokens | `output_per_1m` × `markup` | ≤3 | ≤15 | ≤45 | >45 |
| image | `per_unit` × `markup` | ≤0.03 | ≤0.15 | ≤0.60 | >0.60 |
| second | `per_unit` × `markup` | ≤0.06 | ≤0.30 | ≤1.20 | >1.20 |

Notes:
- Thresholds use the **marked-up** price, not raw, because tier_gating protects our economics, not provider's. If you set markup=1 (reseller-break-even) on Opus it still classifies as premium.
- Thresholds for image/second pricing are calibrated from the chat table: one premium chat turn at 2k output tokens ≈ $0.75 cost (Opus), same as one $0.75 video second. Keeps plan-access consistent across units.
- `tier_override` is the escape hatch. Example use case: DALL-E 3 auto-classifies as mid ($0.04 × 3 = $0.12, between 0.03 and 0.15 → mid) but we want it at `high` for marketing reasons (exclusivity) — set `tier_override='high'`.

## Read path (aggregator)

New module `src/server/services/billing/rates-source.ts`, mirroring `plans-source.ts`:

- `fetchRates()` → `Map<model_id, ModelRate>` via Supabase REST, cached 60s, stale-on-error fallback to last known value (prevents billing outage if Supabase blips).
- `getRate(modelId)` → returns rate or `__default__` row.
- `invalidateRatesCache()` for admin write flow / tests.

Existing call sites that use `getModelRate(modelId)` from `model-rates.ts` migrate to `await getRate(modelId)`. Six call sites (same as plans migration): `BillingService`, stream-parser in chat route, `writeUsageLog`, `calculateCredits`, `classifyModelTier`, `getModelsByTier`. Async becomes pervasive in billing path — acceptable, the path was already async for DB writes.

`MODEL_RATES` constant in code remains for build-time tests only (seed source, tests, local dev when DB isn't reachable). Not imported by runtime code after migration.

## Compute path

Replace `computeCostUsd(modelId, TokenBreakdown)` with a unit-aware function:

```ts
async function computeCostUsd(modelId: string, usage: Usage): Promise<number> {
  const rate = await getRate(modelId);
  switch (rate.pricing_unit) {
    case 'tokens': return computeTokensCost(rate, usage.tokens);
    case 'image':  return (usage.images ?? 1) * rate.per_unit * rate.markup;
    case 'second': return (usage.videoSeconds ?? 0) * rate.per_unit * rate.markup;
  }
}
```

`Usage` is a discriminated union: `{ kind: 'chat', tokens: TokenBreakdown }` | `{ kind: 'image', images: number }` | `{ kind: 'video', videoSeconds: number }`. Stream parser, image/video `chargeAfterGenerate` populate the right variant.

`calculateCredits()` signature stays — it wraps `computeCostUsd` and applies `ceil(rub / CREDIT_VALUE_RUB)`.

Markup is applied inside `computeCostUsd` for tokens too (wasn't before — rates were already "for us to charge", not raw). After migration, DB rows must reflect **raw provider prices** and `markup` is applied in code. This is the most error-prone part of the migration; covered by seed SQL below.

## Seed (migration-safe)

`MODEL_RATES` in code today encodes the RAW provider price (e.g. Opus $25/1M output is real Anthropic pricing). So seed is a direct mirror with `markup=3.00`:

```sql
-- Pseudocode; real file in a migration script
-- NOTE: initial markup=1.00 preserves current user-facing credit cost.
-- Raising to 3.00 is a separate decision (see Risk & rollback for the
-- monetisation rebalance path).
INSERT INTO ai_aggregator.model_rates (model_id, provider, pricing_unit, input_per_1m, output_per_1m, markup) VALUES
  ('claude-opus-4-6',    'anthropic', 'tokens',  5.00, 25.00, 1.00),
  ('claude-sonnet-4-6',  'anthropic', 'tokens',  3.00, 15.00, 1.00),
  ('claude-haiku-4-5-20251001', 'anthropic', 'tokens', 1.00, 5.00, 1.00),
  ('gpt-5.2',            'openai',    'tokens',  1.75, 14.00, 1.00),
  ('gpt-5-mini',         'openai',    'tokens',  0.25, 2.00,  1.00),
  -- ... 31 rows total, from current MODEL_RATES ...
  ('__default__',        'unknown',   'tokens',  5.00, 25.00, 1.00);
```

Image/video models start empty. First thing admin does after deploy — add DALL-E 3, Flux Schnell, and whatever else is actually wired in `/opt/lobechat/.env`. Until added, image/video calls hit `__default__` and get charged at premium chat rates (conservative — user sees bigger credit burn and complains before we under-charge).

## Write path (admin)

`/admin/finance/models` becomes editable:

- Existing read-only table (from previous spec) extends: each row clickable → edit modal.
- Modal fields: `pricing_unit` (select), `input_per_1m` / `output_per_1m` (number, shown when unit=tokens), `per_unit` (number, shown when unit=image|second), `markup` (number, default 3.0), `tier_override` (select with "auto" option), `is_active` (toggle), `notes` (textarea).
- **Cost preview widget** inside modal: inputs for tokens / images / seconds → live recompute `USD_raw → USD_marked_up → credits`. Lets admin sanity-check before save.
- "Add model" button → same form, empty.
- PUT endpoint `/api/admin/model-rates` in webgpt-admin writes to Supabase through service role. Invalidates aggregator's 60s cache via an optional webhook `POST /webapi/admin/rates/invalidate` (Bearer CRON_SECRET) — not required for correctness (cache TTL), only for immediate-effect UX.

Seed-from-code tool: one-time CLI `pnpm tsx scripts/billing/seed-model-rates.ts` that dumps current in-code `MODEL_RATES` to `ai_aggregator.model_rates`. Idempotent via `ON CONFLICT (model_id) DO UPDATE`.

## Enforcement changes

- Tier caps (TIER_DAILY_CAPS) stay as-is in code, but `getModelsByTier(tier)` now pulls from DB via `fetchRates()` instead of iterating a code constant. Unknown-tier model still gets classified via `__default__` fallback (tier='premium' under current defaults → only Pro Max).
- `PRO_MAX_PREMIUM_DAILY_CREDIT_CAP` and friends become the only env-driven knobs; per-model markup tuning happens in the UI.

## Onboarding / Free tier evolution

Out of scope for this spec, but called out because conversion data from Chad AI (2000-word 5-day trial) shows a meaningful impact. Follow-up spec: welcome-bonus 100 credits for 7 days, one-time, on top of monthly 20. Sizing is tight — 100 credits ≈ 2 DALL-E 3 images or 40 GPT-5-mini messages — chosen so Free users can *try* premium-ish models once before upgrading.

## Risk & rollback

- **⚠️ BREAKING CHANGE for existing users: credits_charged is multiplied by 3 after migration.** Today `MODEL_RATES` contains raw provider prices and the code does `(tokens / 1M) * rate * USD_TO_RUB / CREDIT_VALUE_RUB` — markup is implicitly 1. After migration the same model with `markup=3.00` charges 3× more credits. Users on Pro with 8000 credits/month effectively get 2666 credits of cheap + premium chat (at old prices). Mitigations:
  - Communicate to existing paying users before deploy (2 people today — email them manually).
  - Seed with `markup=1.0` initially for continuity, then raise to 3.0 after 24h and update plan monthly credits accordingly (or bake the 3× into monthly credit grants so gross quota feels the same). **Pick this path — seed markup=1.0, handle monetisation rebalance in a follow-up plan** so this migration is invisible to users.
- **Silent under-charge on a bad seed row.** Mitigated by: (a) seed mirrors existing code, (b) admin UI shows cost preview before save, (c) audit column `updated_at` + JSONB column `notes` track manual overrides.
- **Aggregator can't reach Supabase for rates.** `rates-source.ts` serves last-known value from cache forever until connection restored. Catastrophic case (never-cached cold start with Supabase down) → fail-open on chat (user gets service), log loud, but no cost attribution for that window. Matches plans-source behaviour.
- **Image/video model not in catalog.** `chargeBeforeGenerate` validates: must exist, `is_active=true`, `pricing_unit IN ('image','second')` matches the call kind. Otherwise reject with `{ error: 'Model not configured for this operation' }`. Never fall through to `__default__` for image/video — tokens-shaped default can't price per-image/per-second and would silently mis-charge. `__default__` fallback only applies to `kind='chat'`.
- **Rollback.** Drop the new module import, restore code-level `MODEL_RATES`. Table stays (FK-free). One revert commit.

## Migration sequence

1. Migration SQL: `CREATE TABLE ai_aggregator.model_rates` + seed row `__default__`.
2. Seed script: `pnpm tsx scripts/billing/seed-model-rates.ts` from in-code constant → inserts 31 rows.
3. Code: add `rates-source.ts`, switch six call sites from `getModelRate` to `await getRate`.
4. Deploy aggregator (rebuild `lobechat-custom`, `docker compose up -d --force-recreate lobe`).
5. Smoke test: one chat request → `usage_logs.cost_usd` matches expectation (pre-migration value × markup=3).
6. Admin: upgrade `/admin/finance/models` API to PUT + modal form.
7. Deploy admin (rebuild `webgpt-admin` container).
8. Catalog additions: admin adds DALL-E 3, Flux, Sora with real per-unit prices.

## Open items

1. Public "coefficient table" page (like Chad AI's markup 0.5x–40x) — good for trust, consider after we have enough users to matter.
2. Annual pricing with 50% discount — separate spec.
3. Top-up packs with overage markup 2-3x — separate spec, requires new table and UI.
4. Cache warming at aggregator boot so the first request after restart doesn't pay the Supabase RTT — tiny, not blocking.
