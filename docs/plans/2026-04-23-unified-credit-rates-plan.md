# Unified Credit Rates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every model pricing parameter out of `model-rates.ts` into `ai_aggregator.model_rates` table, introduce per-model `markup` (seeded at 3.0), and add unit-aware pricing so image-per-unit and video-per-second stop pretending to be tokens.

**Architecture:** Mirror the plans-source pattern: Supabase REST + 60s in-memory cache in the aggregator, write path through webgpt-admin. Retain `__default__` row as fallback for unknown chat models only. Image/video calls must find an explicit row or reject.

**Tech Stack:** Next.js 16 (aggregator, admin), Drizzle ORM, Supabase PostgREST, vitest (tests), React 19 / shadcn (admin UI), Docker Swarm / docker compose for deploy.

**Spec:** `docs/plans/2026-04-23-unified-credit-rates-design.md`

---

## Task 1: Create `model_rates` table in Supabase

**Files:**
- Create (one-shot SQL): apply via `docker exec supabase-db psql -U postgres`
- No code file — DDL is idempotent, checked in as part of Task 2 seed script

- [ ] **Step 1: Run DDL against prod Supabase**

```bash
docker exec supabase-db psql -U postgres <<'SQL'
CREATE TABLE IF NOT EXISTS ai_aggregator.model_rates (
  id             serial PRIMARY KEY,
  model_id       text UNIQUE NOT NULL,
  provider       text NOT NULL,
  pricing_unit   text NOT NULL,
  input_per_1m   numeric(10,4),
  output_per_1m  numeric(10,4),
  per_unit       numeric(10,4),
  markup         numeric(5,2) NOT NULL DEFAULT 3.00,
  tier_override  text,
  is_active      boolean NOT NULL DEFAULT true,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (pricing_unit IN ('tokens', 'image', 'second')),
  CHECK (
    (pricing_unit = 'tokens' AND input_per_1m IS NOT NULL AND output_per_1m IS NOT NULL)
    OR (pricing_unit IN ('image', 'second') AND per_unit IS NOT NULL)
  ),
  CHECK (markup > 0),
  CHECK (tier_override IS NULL OR tier_override IN ('cheap','mid','high','premium'))
);

CREATE INDEX IF NOT EXISTS model_rates_provider_idx ON ai_aggregator.model_rates(provider);
CREATE INDEX IF NOT EXISTS model_rates_pricing_unit_idx ON ai_aggregator.model_rates(pricing_unit);
CREATE INDEX IF NOT EXISTS model_rates_is_active_idx ON ai_aggregator.model_rates(is_active);
SQL
```

- [ ] **Step 2: Verify schema**

Run:
```bash
docker exec supabase-db psql -U postgres -c "\d ai_aggregator.model_rates"
```
Expected: columns listed, all three CHECKs present, 3 indexes.

- [ ] **Step 3: Commit the DDL into a repo migration file for future re-create**

```bash
cat > /home/deploy/projects/ai-aggregator-lobechat/packages/database/migrations/ai-aggregator/0001_model_rates.sql <<'SQL'
-- DDL for ai_aggregator.model_rates — applied to prod 2026-04-23
-- See docs/plans/2026-04-23-unified-credit-rates-design.md §Data model
CREATE TABLE IF NOT EXISTS ai_aggregator.model_rates (
  id             serial PRIMARY KEY,
  model_id       text UNIQUE NOT NULL,
  provider       text NOT NULL,
  pricing_unit   text NOT NULL,
  input_per_1m   numeric(10,4),
  output_per_1m  numeric(10,4),
  per_unit       numeric(10,4),
  markup         numeric(5,2) NOT NULL DEFAULT 3.00,
  tier_override  text,
  is_active      boolean NOT NULL DEFAULT true,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (pricing_unit IN ('tokens', 'image', 'second')),
  CHECK (
    (pricing_unit = 'tokens' AND input_per_1m IS NOT NULL AND output_per_1m IS NOT NULL)
    OR (pricing_unit IN ('image', 'second') AND per_unit IS NOT NULL)
  ),
  CHECK (markup > 0),
  CHECK (tier_override IS NULL OR tier_override IN ('cheap','mid','high','premium'))
);

CREATE INDEX IF NOT EXISTS model_rates_provider_idx ON ai_aggregator.model_rates(provider);
CREATE INDEX IF NOT EXISTS model_rates_pricing_unit_idx ON ai_aggregator.model_rates(pricing_unit);
CREATE INDEX IF NOT EXISTS model_rates_is_active_idx ON ai_aggregator.model_rates(is_active);
SQL
mkdir -p /home/deploy/projects/ai-aggregator-lobechat/packages/database/migrations/ai-aggregator
cd /home/deploy/projects/ai-aggregator-lobechat
git add packages/database/migrations/ai-aggregator/0001_model_rates.sql
git -c user.name=pasha -c user.email=2396741@gmail.com commit -m "feat(billing): model_rates table DDL checkpoint"
git push origin canary
```

---

## Task 2: Seed script — all 31 models from `MODEL_RATES`

**Files:**
- Create: `scripts/billing/seed-model-rates.ts`
- Uses: `src/server/modules/billing/model-rates.ts` (existing, read-only)

- [ ] **Step 1: Write the seed script**

```typescript
// scripts/billing/seed-model-rates.ts
import { MODEL_RATES } from '../../src/server/modules/billing/model-rates';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://supabase.pashavin.ru';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY missing');
  process.exit(1);
}

// Provider lookup is duplicated from model-rates.ts (kept unexported there).
// Keep in sync if openRouterPrefixes changes.
const PROVIDER_OF: Record<string, string> = {
  'deepseek-chat': 'deepseek', 'deepseek-reasoner': 'deepseek',
  'gpt-5-mini': 'openai', 'gpt-5-nano': 'openai', 'gpt-5.1': 'openai',
  'gpt-5.2': 'openai', 'gpt-5-chat-latest': 'openai',
  'gpt-4.1-mini': 'openai', 'gpt-4.1': 'openai', 'gpt-4o': 'openai',
  'gpt-4o-mini': 'openai', 'chatgpt-4o-latest': 'openai', 'gpt-4-turbo': 'openai',
  'o4-mini': 'openai', 'o3': 'openai',
  'gemini-2.5-flash': 'google', 'gemini-2.5-pro': 'google',
  'gemini-3-flash-preview': 'google', 'gemini-3-pro-preview': 'google',
  'gemini-3.1-pro-preview': 'google',
  'claude-haiku-4-5-20251001': 'anthropic', 'claude-sonnet-4-6': 'anthropic',
  'claude-sonnet-4-5-20250929': 'anthropic', 'claude-opus-4-6': 'anthropic',
  'claude-opus-4-5-20251101': 'anthropic',
  'grok-4': 'x-ai',
  'MiniMax-M2.5': 'minimax', 'MiniMax-M2.5-highspeed': 'minimax', 'MiniMax-M2.1': 'minimax',
};

const rows = [
  // __default__ MUST come first so cache fallback is consistent with raw-insert order
  {
    model_id: '__default__',
    provider: 'unknown',
    pricing_unit: 'tokens',
    input_per_1m: 5.0,
    output_per_1m: 25.0,
    markup: 3.0,
    notes: 'Fallback for unknown chat models. Never delete.',
  },
  ...Object.entries(MODEL_RATES)
    .filter(([id]) => !id.includes('/')) // skip openrouter-prefixed duplicates
    .map(([id, rate]) => ({
      model_id: id,
      provider: PROVIDER_OF[id] || 'unknown',
      pricing_unit: 'tokens' as const,
      input_per_1m: rate.inputPer1M,
      output_per_1m: rate.outputPer1M,
      markup: 3.0,
    })),
];

async function main() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/model_rates`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY!,
      Authorization: `Bearer ${SUPABASE_KEY!}`,
      'Accept-Profile': 'ai_aggregator',
      'Content-Profile': 'ai_aggregator',
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    console.error('seed failed:', res.status, await res.text());
    process.exit(1);
  }
  const data = (await res.json()) as unknown[];
  console.log(`seeded ${data.length} model_rates rows`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run seed script**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
export SUPABASE_SERVICE_ROLE_KEY=$(grep ^SUPABASE_SERVICE_ROLE_KEY /opt/lobechat/.env | cut -d= -f2)
pnpm tsx scripts/billing/seed-model-rates.ts
```

Expected output: `seeded 32 model_rates rows` (31 models + `__default__`).

- [ ] **Step 3: Verify row count and one sample**

```bash
docker exec supabase-db psql -U postgres -c "SELECT count(*), sum(CASE WHEN model_id='__default__' THEN 1 ELSE 0 END) AS default_present FROM ai_aggregator.model_rates;"
docker exec supabase-db psql -U postgres -c "SELECT model_id, provider, input_per_1m, output_per_1m, markup FROM ai_aggregator.model_rates WHERE model_id='claude-opus-4-6';"
```
Expected: count=32, default_present=1; Opus row shows provider=anthropic, input=5.0, output=25.0, markup=3.00.

- [ ] **Step 4: Commit**

```bash
git add scripts/billing/seed-model-rates.ts
git -c user.name=pasha -c user.email=2396741@gmail.com commit -m "feat(billing): seed-model-rates.ts — mirror MODEL_RATES to model_rates table"
git push origin canary
```

---

## Task 3: `rates-source.ts` — Supabase REST read path + cache

**Files:**
- Create: `src/server/services/billing/rates-source.ts`
- Create: `src/server/services/billing/__tests__/rates-source.test.ts`

- [ ] **Step 1: Write the failing test**

Test file `src/server/services/billing/__tests__/rates-source.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchRate, fetchAllRates, invalidateRatesCache } from '../rates-source';

const OPUS_ROW = {
  model_id: 'claude-opus-4-6',
  provider: 'anthropic',
  pricing_unit: 'tokens',
  input_per_1m: '5.0000',
  output_per_1m: '25.0000',
  per_unit: null,
  markup: '3.00',
  tier_override: null,
  is_active: true,
};
const DEFAULT_ROW = {
  model_id: '__default__',
  provider: 'unknown',
  pricing_unit: 'tokens',
  input_per_1m: '5.0000',
  output_per_1m: '25.0000',
  per_unit: null,
  markup: '3.00',
  tier_override: null,
  is_active: true,
};

const mockFetch = vi.fn();

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  globalThis.fetch = mockFetch as unknown as typeof fetch;
  invalidateRatesCache();
  mockFetch.mockReset();
});

afterEach(() => {
  invalidateRatesCache();
});

describe('fetchRate', () => {
  it('returns normalised row for a known model', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [OPUS_ROW, DEFAULT_ROW],
    });
    const rate = await fetchRate('claude-opus-4-6');
    expect(rate).toMatchObject({
      modelId: 'claude-opus-4-6',
      pricingUnit: 'tokens',
      inputPer1M: 5,
      outputPer1M: 25,
      markup: 3,
      isActive: true,
    });
  });

  it('falls back to __default__ row for unknown chat models', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [OPUS_ROW, DEFAULT_ROW],
    });
    const rate = await fetchRate('some-unknown-model');
    expect(rate.modelId).toBe('__default__');
    expect(rate.pricingUnit).toBe('tokens');
  });

  it('returns undefined when no row and no __default__', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [OPUS_ROW],
    });
    const rate = await fetchRate('some-unknown-model');
    expect(rate).toBeUndefined();
  });

  it('serves stale cache on fetch error', async () => {
    // First call seeds cache
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [OPUS_ROW, DEFAULT_ROW] });
    await fetchRate('claude-opus-4-6');
    // Second call fails
    mockFetch.mockRejectedValueOnce(new Error('network down'));
    invalidateRatesCache();
    // Third call: fresh fetch fails, but cache returns stale
    mockFetch.mockRejectedValueOnce(new Error('network down'));
    const rate = await fetchRate('claude-opus-4-6');
    expect(rate?.modelId).toBe('claude-opus-4-6');
  });
});

describe('fetchAllRates', () => {
  it('returns all active rows', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [OPUS_ROW, DEFAULT_ROW, { ...OPUS_ROW, model_id: 'inactive', is_active: false }],
    });
    const rates = await fetchAllRates();
    expect(rates.map((r) => r.modelId).sort()).toEqual(['__default__', 'claude-opus-4-6']);
  });
});
```

- [ ] **Step 2: Run the test — must fail**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
pnpm vitest run src/server/services/billing/__tests__/rates-source.test.ts
```
Expected: FAIL — `Cannot find module '../rates-source'`.

- [ ] **Step 3: Implement `rates-source.ts`**

```typescript
// src/server/services/billing/rates-source.ts
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
  modelId: string;
  provider: string;
  pricingUnit: PricingUnit;
  inputPer1M: number | null; // null when unit=image|second
  outputPer1M: number | null;
  perUnit: number | null; // null when unit=tokens
  markup: number;
  tierOverride: TierOverride;
  isActive: boolean;
}

interface RawRateRow {
  model_id: string;
  provider: string;
  pricing_unit: PricingUnit;
  input_per_1m: string | null;
  output_per_1m: string | null;
  per_unit: string | null;
  markup: string;
  tier_override: TierOverride;
  is_active: boolean;
}

const CACHE_TTL_MS = 60_000;
const SELECT =
  'model_id,provider,pricing_unit,input_per_1m,output_per_1m,per_unit,markup,tier_override,is_active';

let cache: { rates: RateView[]; byId: Map<string, RateView>; expiresAt: number } | null = null;
let inflight: Promise<RateView[]> | null = null;

function mapRow(row: RawRateRow): RateView {
  return {
    modelId: row.model_id,
    provider: row.provider,
    pricingUnit: row.pricing_unit,
    inputPer1M: row.input_per_1m !== null ? Number(row.input_per_1m) : null,
    outputPer1M: row.output_per_1m !== null ? Number(row.output_per_1m) : null,
    perUnit: row.per_unit !== null ? Number(row.per_unit) : null,
    markup: Number(row.markup),
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
      apikey: key,
      Authorization: `Bearer ${key}`,
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
      cache = { rates, byId, expiresAt: now + CACHE_TTL_MS };
      return rates;
    })
    .catch((err) => {
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

export async function fetchRate(modelId: string): Promise<RateView | undefined> {
  await getRates();
  const byId = cache?.byId;
  if (!byId) return undefined;
  return byId.get(modelId) ?? byId.get('__default__');
}

export function invalidateRatesCache(): void {
  cache = null;
}
```

- [ ] **Step 4: Run the test — must pass**

```bash
pnpm vitest run src/server/services/billing/__tests__/rates-source.test.ts
```
Expected: 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/billing/rates-source.ts src/server/services/billing/__tests__/rates-source.test.ts
git -c user.name=pasha -c user.email=2396741@gmail.com commit -m "feat(billing): rates-source.ts — Supabase REST + 60s cache, mirrors plans-source"
git push origin canary
```

---

## Task 4: Unit-aware `computeCostUsd` — refactor with tests

**Files:**
- Modify: `src/server/modules/billing/model-rates.ts`
- Create: `src/server/modules/billing/__tests__/compute-cost.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/server/modules/billing/__tests__/compute-cost.test.ts
import { describe, expect, it } from 'vitest';

import { computeCostUsdFromRate, type RateView } from '../compute-cost';

const TOKENS_RATE: RateView = {
  modelId: 'claude-opus-4-6',
  provider: 'anthropic',
  pricingUnit: 'tokens',
  inputPer1M: 5,
  outputPer1M: 25,
  perUnit: null,
  markup: 3,
  tierOverride: null,
  isActive: true,
};

const IMAGE_RATE: RateView = {
  modelId: 'dall-e-3',
  provider: 'openai',
  pricingUnit: 'image',
  inputPer1M: null,
  outputPer1M: null,
  perUnit: 0.04,
  markup: 3,
  tierOverride: null,
  isActive: true,
};

const VIDEO_RATE: RateView = {
  modelId: 'sora-2',
  provider: 'openai',
  pricingUnit: 'second',
  inputPer1M: null,
  outputPer1M: null,
  perUnit: 0.05,
  markup: 3,
  tierOverride: null,
  isActive: true,
};

describe('computeCostUsdFromRate — tokens', () => {
  it('multiplies tokens by rate and applies markup', () => {
    // 1M input + 1M output = ($5 + $25) × markup 3 = $90
    const cost = computeCostUsdFromRate(TOKENS_RATE, {
      kind: 'chat',
      tokens: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
    });
    expect(cost).toBeCloseTo(90, 4);
  });

  it('handles cache tokens with correct multipliers', () => {
    // cache_write_5m = 1M × $5 × 1.25 = $6.25
    // After markup 3: $18.75
    const cost = computeCostUsdFromRate(TOKENS_RATE, {
      kind: 'chat',
      tokens: {
        inputTokens: 0,
        outputTokens: 0,
        cacheWrite5mTokens: 1_000_000,
      },
    });
    expect(cost).toBeCloseTo(18.75, 4);
  });
});

describe('computeCostUsdFromRate — image', () => {
  it('multiplies images by per_unit and markup', () => {
    // 5 × $0.04 × 3 = $0.60
    const cost = computeCostUsdFromRate(IMAGE_RATE, { kind: 'image', images: 5 });
    expect(cost).toBeCloseTo(0.6, 4);
  });

  it('defaults to 1 image if not provided', () => {
    const cost = computeCostUsdFromRate(IMAGE_RATE, { kind: 'image', images: undefined });
    expect(cost).toBeCloseTo(0.12, 4); // $0.04 × 3 × 1
  });
});

describe('computeCostUsdFromRate — second (video)', () => {
  it('multiplies seconds by per_unit and markup', () => {
    // 10 sec × $0.05 × 3 = $1.50
    const cost = computeCostUsdFromRate(VIDEO_RATE, { kind: 'video', videoSeconds: 10 });
    expect(cost).toBeCloseTo(1.5, 4);
  });

  it('returns 0 for 0 seconds', () => {
    const cost = computeCostUsdFromRate(VIDEO_RATE, { kind: 'video', videoSeconds: 0 });
    expect(cost).toBe(0);
  });
});

describe('computeCostUsdFromRate — pricing_unit/kind mismatch', () => {
  it('returns 0 for video-kind against tokens-rate (should not happen)', () => {
    const cost = computeCostUsdFromRate(TOKENS_RATE, { kind: 'video', videoSeconds: 10 });
    expect(cost).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test — must fail**

```bash
pnpm vitest run src/server/modules/billing/__tests__/compute-cost.test.ts
```
Expected: FAIL — `Cannot find module '../compute-cost'`.

- [ ] **Step 3: Extract `compute-cost.ts`**

Create `src/server/modules/billing/compute-cost.ts`:

```typescript
// src/server/modules/billing/compute-cost.ts
/**
 * Pure billing math. No side effects, no DB, no network — just arithmetic.
 * Isolated for testability and so the rest of the codebase can depend on it
 * without pulling in rates-source.
 */

import type { RateView } from '@/server/services/billing/rates-source';

export type { RateView };

export interface ChatUsage {
  kind: 'chat';
  tokens: {
    inputTokens: number;
    outputTokens: number;
    cacheWrite5mTokens?: number;
    cacheWrite1hTokens?: number;
    cacheReadTokens?: number;
  };
}
export interface ImageUsage {
  kind: 'image';
  images?: number; // default 1
}
export interface VideoUsage {
  kind: 'video';
  videoSeconds: number;
}
export type Usage = ChatUsage | ImageUsage | VideoUsage;

export function computeCostUsdFromRate(rate: RateView, usage: Usage): number {
  if (rate.pricingUnit === 'tokens' && usage.kind === 'chat') {
    const inPer1M = rate.inputPer1M ?? 0;
    const outPer1M = rate.outputPer1M ?? 0;
    const t = usage.tokens;
    const baseCost =
      (t.inputTokens / 1_000_000) * inPer1M +
      ((t.cacheWrite5mTokens ?? 0) / 1_000_000) * inPer1M * 1.25 +
      ((t.cacheWrite1hTokens ?? 0) / 1_000_000) * inPer1M * 2.0 +
      ((t.cacheReadTokens ?? 0) / 1_000_000) * inPer1M * 0.1 +
      (t.outputTokens / 1_000_000) * outPer1M;
    return baseCost * rate.markup;
  }
  if (rate.pricingUnit === 'image' && usage.kind === 'image') {
    const perUnit = rate.perUnit ?? 0;
    return (usage.images ?? 1) * perUnit * rate.markup;
  }
  if (rate.pricingUnit === 'second' && usage.kind === 'video') {
    const perUnit = rate.perUnit ?? 0;
    return usage.videoSeconds * perUnit * rate.markup;
  }
  // Mismatch — don't silently mis-charge; return 0 and caller must have rejected earlier.
  return 0;
}
```

- [ ] **Step 4: Run the test — must pass**

```bash
pnpm vitest run src/server/modules/billing/__tests__/compute-cost.test.ts
```
Expected: 7 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/billing/compute-cost.ts src/server/modules/billing/__tests__/compute-cost.test.ts
git -c user.name=pasha -c user.email=2396741@gmail.com commit -m "feat(billing): compute-cost.ts — pure unit-aware USD math"
git push origin canary
```

---

## Task 5: Rewire `calculateCredits` and `recordTokenUsage` on top of `rates-source`

**Files:**
- Modify: `src/server/modules/billing/model-rates.ts` — deprecate `computeCostUsd` and `calculateCredits` to be thin wrappers; add async variants
- Modify: `src/server/modules/billing/checkUsageLimit.ts` — use rates-source + new math

- [ ] **Step 1: Add async wrapper in `model-rates.ts`**

Append to `src/server/modules/billing/model-rates.ts` (after existing exports):

```typescript
import { fetchRate } from '@/server/services/billing/rates-source';
import { computeCostUsdFromRate, type Usage } from './compute-cost';

/**
 * New unit-aware credit calculator. Pulls rate from Supabase-backed cache,
 * computes USD cost with markup, converts to credits (1 credit = CREDIT_VALUE_RUB).
 *
 * Replaces synchronous `calculateCredits(modelId, inputTokens, outputTokens)`
 * call sites. Returns 1 (floor) if cost is 0 but usage is non-empty — same
 * behaviour as old formula's max(1, ceil(...)).
 */
export async function calculateCreditsAsync(modelId: string, usage: Usage): Promise<number> {
  const rate = await fetchRate(modelId);
  if (!rate) {
    console.warn(`[billing] no rate for model=${modelId}, charging 1 credit floor`);
    return 1;
  }
  const costUsd = computeCostUsdFromRate(rate, usage);
  const costRub = costUsd * USD_TO_RUB;
  return Math.max(1, Math.ceil(costRub / CREDIT_VALUE_RUB));
}

// Keep old MODEL_RATES export for now — still used by legacy synchronous paths.
// Task 11 removes this.
```

- [ ] **Step 2: Modify `recordTokenUsage` to use async path with Usage**

Open `src/server/modules/billing/checkUsageLimit.ts`. Replace the body of `recordTokenUsage`:

```typescript
import { fetchRate } from '@/server/services/billing/rates-source';
import { computeCostUsdFromRate, type Usage } from './compute-cost';
import { calculateCreditsAsync, USD_TO_RUB, CREDIT_VALUE_RUB } from './model-rates';

// ... keep existing exports / TIER_DAILY_CAPS unchanged ...

export async function recordTokenUsage(
  db: LobeChatDatabase,
  userId: string,
  tokensUsed: number,
  modelId?: string,
  outputTokens?: number,
  opts?: RecordTokenUsageExtras,
): Promise<void> {
  if (tokensUsed <= 0 && (!outputTokens || outputTokens <= 0)) return;
  try {
    const usage: Usage = {
      kind: 'chat',
      tokens: {
        inputTokens: tokensUsed,
        outputTokens: outputTokens ?? 0,
        cacheWrite5mTokens: opts?.cacheWrite5mTokens ?? 0,
        cacheWrite1hTokens: opts?.cacheWrite1hTokens ?? 0,
        cacheReadTokens: opts?.cacheReadTokens ?? 0,
      },
    };
    const credits = modelId
      ? await calculateCreditsAsync(modelId, usage)
      : Math.max(1, Math.ceil(tokensUsed / 2500));

    const billingService = new BillingService(db, userId);
    await billingService.incrementTokensUsed(credits);

    const { writeUsageLog } = await import('@/server/modules/analytics/writeUsageLog');
    await writeUsageLog(db, {
      userId,
      model: modelId || 'unknown',
      provider: opts?.provider || 'unknown',
      inputTokens: tokensUsed,
      outputTokens: outputTokens ?? 0,
      cacheWrite5mTokens: opts?.cacheWrite5mTokens ?? 0,
      cacheWrite1hTokens: opts?.cacheWrite1hTokens ?? 0,
      cacheReadTokens: opts?.cacheReadTokens ?? 0,
      creditsCharged: credits,
      kind: opts?.kind || 'chat',
    });

    console.info(
      `[billing] charged ${credits} credits: user=${userId} model=${modelId || 'unknown'} in=${tokensUsed} out=${outputTokens || 0} cw5m=${opts?.cacheWrite5mTokens ?? 0} cw1h=${opts?.cacheWrite1hTokens ?? 0} cr=${opts?.cacheReadTokens ?? 0}`,
    );
  } catch (error) {
    const msg = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
    console.error(`[billing] recordTokenUsage FAIL user=${userId}: ${msg}`);
  }
}
```

Remove old `calculateCredits` import at top — replaced by `calculateCreditsAsync`.

- [ ] **Step 3: Update `writeUsageLog.ts` cost math**

Open `src/server/modules/analytics/writeUsageLog.ts`, replace `computeUsageLogRow` body:

```typescript
import { fetchRate } from '@/server/services/billing/rates-source';
import { computeCostUsdFromRate, type Usage } from '@/server/modules/billing/compute-cost';
import { USD_TO_RUB } from '@/server/modules/billing/model-rates';

// ... keep interface WriteUsageLogInput as-is ...

export async function computeUsageLogRow(input: WriteUsageLogInput) {
  const rate = await fetchRate(input.model);
  const usage: Usage = {
    kind: 'chat',
    tokens: {
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      cacheWrite5mTokens: input.cacheWrite5mTokens ?? 0,
      cacheWrite1hTokens: input.cacheWrite1hTokens ?? 0,
      cacheReadTokens: input.cacheReadTokens ?? 0,
    },
  };
  const costUsd = rate ? computeCostUsdFromRate(rate, usage) : 0;
  const costRub = costUsd * USD_TO_RUB;

  return {
    userId: input.userId,
    model: input.model,
    provider: input.provider,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    cacheWrite5mTokens: input.cacheWrite5mTokens ?? 0,
    cacheWrite1hTokens: input.cacheWrite1hTokens ?? 0,
    cacheReadTokens: input.cacheReadTokens ?? 0,
    creditsCharged: input.creditsCharged,
    costUsd: costUsd.toFixed(6),
    costRub: costRub.toFixed(4),
    exchangeRate: USD_TO_RUB.toFixed(4),
    kind: input.kind,
  };
}

export async function writeUsageLog(
  db: LobeChatDatabase,
  input: WriteUsageLogInput,
): Promise<void> {
  const row = await computeUsageLogRow(input);
  try {
    await db.insert(usageLogs).values(row);
    console.info(
      `[analytics] usage_logs OK user=${input.userId} model=${input.model} credits=${input.creditsCharged} cost_usd=${row.costUsd}`,
    );
  } catch (error) {
    const msg = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
    console.error(
      `[analytics] usage_logs FAIL user=${input.userId} model=${input.model} credits=${input.creditsCharged}: ${msg}`,
    );
    console.error('[analytics] usage_logs row:', JSON.stringify(row));
  }
}
```

- [ ] **Step 4: Run TS type check**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
npx tsc --noEmit 2>&1 | grep -E "error TS" | head -20
```
Expected: no output (no TS errors).

- [ ] **Step 5: Run affected tests**

```bash
pnpm vitest run src/server/modules/billing src/server/services/billing
```
Expected: all green (existing `model-tiers.test.ts` still passes).

- [ ] **Step 6: Commit**

```bash
git add src/server/modules/billing/model-rates.ts src/server/modules/billing/checkUsageLimit.ts src/server/modules/analytics/writeUsageLog.ts
git -c user.name=pasha -c user.email=2396741@gmail.com commit -m "refactor(billing): calculateCreditsAsync reads rates from Supabase"
git push origin canary
```

---

## Task 6: Async `classifyModelTier` + `getModelsByTier`

**Files:**
- Modify: `src/server/modules/billing/model-tiers.ts`
- Modify: `src/server/modules/billing/__tests__/model-tiers.test.ts`

- [ ] **Step 1: Update the test**

Replace `src/server/modules/billing/__tests__/model-tiers.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { classifyModelTierAsync, getModelsByTierAsync, invalidateRatesCache } from '../model-tiers';

const ROWS = [
  { model_id: 'claude-opus-4-6', provider: 'anthropic', pricing_unit: 'tokens', input_per_1m: '5', output_per_1m: '25', per_unit: null, markup: '3', tier_override: null, is_active: true },
  { model_id: 'claude-sonnet-4-6', provider: 'anthropic', pricing_unit: 'tokens', input_per_1m: '3', output_per_1m: '15', per_unit: null, markup: '3', tier_override: null, is_active: true },
  { model_id: 'claude-haiku-4-5-20251001', provider: 'anthropic', pricing_unit: 'tokens', input_per_1m: '1', output_per_1m: '5', per_unit: null, markup: '3', tier_override: null, is_active: true },
  { model_id: 'gpt-5-nano', provider: 'openai', pricing_unit: 'tokens', input_per_1m: '0.1', output_per_1m: '0.4', per_unit: null, markup: '3', tier_override: null, is_active: true },
  { model_id: 'dall-e-3', provider: 'openai', pricing_unit: 'image', input_per_1m: null, output_per_1m: null, per_unit: '0.04', markup: '3', tier_override: null, is_active: true },
  { model_id: 'sora-2', provider: 'openai', pricing_unit: 'second', input_per_1m: null, output_per_1m: null, per_unit: '0.05', markup: '3', tier_override: null, is_active: true },
  { model_id: '__default__', provider: 'unknown', pricing_unit: 'tokens', input_per_1m: '5', output_per_1m: '25', per_unit: null, markup: '3', tier_override: null, is_active: true },
];

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ROWS }) as unknown as typeof fetch;
  invalidateRatesCache();
});

afterEach(() => {
  invalidateRatesCache();
});

describe('classifyModelTierAsync — tokens', () => {
  it('opus × markup 3 → premium', async () => {
    // output $25 × markup 3 = $75 → > $45 → premium
    expect(await classifyModelTierAsync('claude-opus-4-6')).toBe('premium');
  });

  it('sonnet × markup 3 → high (at upper bound)', async () => {
    // $15 × 3 = $45 hits the high/premium boundary exactly; using ≤ it falls into high.
    expect(await classifyModelTierAsync('claude-sonnet-4-6')).toBe('high');
  });

  it('haiku × markup 3 → high', async () => {
    // $5 × 3 = $15 → high (≤15)
    expect(await classifyModelTierAsync('claude-haiku-4-5-20251001')).toBe('high');
  });

  it('gpt-5-nano × markup 3 → cheap', async () => {
    // $0.4 × 3 = $1.2 → mid (≤3)... actually wait: cheap threshold ≤3, so $1.2 is cheap
    expect(await classifyModelTierAsync('gpt-5-nano')).toBe('cheap');
  });
});

describe('classifyModelTierAsync — image', () => {
  it('dall-e-3 × markup 3 = $0.12 → mid', async () => {
    expect(await classifyModelTierAsync('dall-e-3')).toBe('mid');
  });
});

describe('classifyModelTierAsync — second', () => {
  it('sora-2 × markup 3 = $0.15/sec → mid', async () => {
    expect(await classifyModelTierAsync('sora-2')).toBe('mid');
  });
});

describe('classifyModelTierAsync — unknown model', () => {
  it('falls back to __default__ classification (premium)', async () => {
    expect(await classifyModelTierAsync('absolutely-unknown-model')).toBe('premium');
  });
});

describe('classifyModelTierAsync — tier_override', () => {
  it('honours tier_override when set', async () => {
    const withOverride = [{ ...ROWS[0], tier_override: 'cheap' }, ROWS[6]];
    globalThis.fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => withOverride }) as unknown as typeof fetch;
    invalidateRatesCache();
    expect(await classifyModelTierAsync('claude-opus-4-6')).toBe('cheap');
  });
});

describe('getModelsByTierAsync', () => {
  it('buckets all rates correctly', async () => {
    const premium = await getModelsByTierAsync('premium');
    expect(premium).toContain('claude-opus-4-6');
    const mid = await getModelsByTierAsync('mid');
    expect(mid).toContain('dall-e-3');
    expect(mid).toContain('sora-2');
  });
});
```

- [ ] **Step 2: Run the updated tests — must fail**

```bash
pnpm vitest run src/server/modules/billing/__tests__/model-tiers.test.ts
```
Expected: FAIL — `classifyModelTierAsync is not defined`.

- [ ] **Step 3: Rewrite `model-tiers.ts`**

Replace `src/server/modules/billing/model-tiers.ts`:

```typescript
import {
  type RateView,
  fetchAllRates,
  fetchRate,
  invalidateRatesCache as invalidateSource,
} from '@/server/services/billing/rates-source';

export type ModelTier = 'cheap' | 'mid' | 'high' | 'premium';
export type PlanSlug = 'free' | 'basic' | 'pro' | 'pro_max';

/**
 * Tier is classified from the **marked-up** price (what WE charge, not what
 * provider charges). Keeps plan-access consistent even if markup changes.
 * Unit-aware thresholds; see design doc §Tier classification.
 */
function tierFromRate(rate: RateView): ModelTier {
  if (rate.tierOverride) return rate.tierOverride;
  const markedUp = rate.markup;
  if (rate.pricingUnit === 'tokens') {
    const out = (rate.outputPer1M ?? 0) * markedUp;
    if (out <= 3) return 'cheap';
    if (out <= 15) return 'mid';
    if (out <= 45) return 'high';
    return 'premium';
  }
  if (rate.pricingUnit === 'image') {
    const u = (rate.perUnit ?? 0) * markedUp;
    if (u <= 0.03) return 'cheap';
    if (u <= 0.15) return 'mid';
    if (u <= 0.6) return 'high';
    return 'premium';
  }
  // second (video)
  const u = (rate.perUnit ?? 0) * markedUp;
  if (u <= 0.06) return 'cheap';
  if (u <= 0.3) return 'mid';
  if (u <= 1.2) return 'high';
  return 'premium';
}

export async function classifyModelTierAsync(modelId: string): Promise<ModelTier> {
  const rate = await fetchRate(modelId);
  if (!rate) return 'premium'; // conservative default when catalog is silent
  return tierFromRate(rate);
}

export const PLAN_MAX_TIER: Record<PlanSlug, ModelTier> = {
  basic: 'mid',
  free: 'cheap',
  pro: 'high',
  pro_max: 'premium',
};

const TIER_ORDER: ModelTier[] = ['cheap', 'mid', 'high', 'premium'];

export async function isModelAllowedForPlanAsync(
  modelId: string,
  planSlug: string,
): Promise<boolean> {
  const planTier = PLAN_MAX_TIER[planSlug as PlanSlug] ?? 'cheap';
  const modelTier = await classifyModelTierAsync(modelId);
  return TIER_ORDER.indexOf(modelTier) <= TIER_ORDER.indexOf(planTier);
}

export async function getRequiredPlanForModelAsync(modelId: string): Promise<PlanSlug> {
  const tier = await classifyModelTierAsync(modelId);
  if (tier === 'cheap') return 'free';
  if (tier === 'mid') return 'basic';
  if (tier === 'high') return 'pro';
  return 'pro_max';
}

export async function getModelsByTierAsync(tier: ModelTier): Promise<string[]> {
  const rates = await fetchAllRates();
  return rates.filter((r) => tierFromRate(r) === tier).map((r) => r.modelId);
}

export function invalidateRatesCache(): void {
  invalidateSource();
}
```

- [ ] **Step 4: Update callers of old synchronous API**

`checkUsageLimit.ts` currently calls `classifyModelTier(modelId)` and `getModelsByTier(tier)` synchronously. Convert:

In `src/server/modules/billing/checkUsageLimit.ts`:

```typescript
// Change import at top:
import {
  type ModelTier,
  type PlanSlug,
  classifyModelTierAsync,
  getModelsByTierAsync,
} from './model-tiers';

// In the per-tier cap block inside checkUsageLimit, replace:
//   const modelTier = classifyModelTier(modelId);
//   ...
//   const tierModels = getModelsByTier(modelTier);
// with:
const modelTier = await classifyModelTierAsync(modelId);
const capMap = TIER_DAILY_CAPS[plan.slug as PlanSlug] ?? {};
const tierCap = capMap[modelTier];
if (tierCap && tierCap > 0) {
  const tierModels = await getModelsByTierAsync(modelTier);
  // ... rest unchanged ...
}
```

- [ ] **Step 5: Search the rest of src/ for remaining sync callers**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
grep -rn "classifyModelTier\b\|isModelAllowedForPlan\b\|getRequiredPlanForModel\b\|getModelsByTier\b" src/ \
  | grep -v "Async\b" \
  | grep -v "test"
```
Expected: 0 matches after Step 4 is complete. Fix each by adding `Async` and `await`.

- [ ] **Step 6: Run tests**

```bash
pnpm vitest run src/server/modules/billing
```
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/server/modules/billing/model-tiers.ts src/server/modules/billing/__tests__/model-tiers.test.ts src/server/modules/billing/checkUsageLimit.ts
git -c user.name=pasha -c user.email=2396741@gmail.com commit -m "refactor(billing): async tier classifier driven by rates-source"
git push origin canary
```

---

## Task 7: Chat route wiring — cache tokens already extracted, now reach async classifier

**Files:**
- Modify: `src/app/(backend)/webapi/chat/[provider]/route.ts`

- [ ] **Step 1: Check what changed**

```bash
grep -n "classifyModelTier\|recordTokenUsage\|checkUsageLimit" /home/deploy/projects/ai-aggregator-lobechat/src/app/\(backend\)/webapi/chat/\[provider\]/route.ts
```
Expected: only `await checkUsageLimit(serverDB, userId, data.model)` and `await recordTokenUsage(...)`. Both already async — Task 5 + Task 6 kept their signatures, so **no code change needed in the route itself**.

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit 2>&1 | grep "chat/\[provider\]/route" | head
```
Expected: empty.

- [ ] **Step 3: Nothing to commit — sanity confirmed**

If a stray sync call showed up, fix it and commit here.

---

## Task 8: Image/Video — strict-mode `chargeBeforeGenerate`, Usage-shaped `chargeAfterGenerate`

**Files:**
- Modify: `src/business/server/image-generation/chargeBeforeGenerate.ts`
- Modify: `src/business/server/image-generation/chargeAfterGenerate.ts`
- Modify: `src/business/server/video-generation/chargeBeforeGenerate.ts`
- Modify: `src/business/server/video-generation/chargeAfterGenerate.ts`

- [ ] **Step 1: Add strict pricing_unit validation in chargeBeforeGenerate (image)**

Replace `src/business/server/image-generation/chargeBeforeGenerate.ts`:

```typescript
import { getServerDB } from '@/database/core/db-adaptor';
import { type NewGeneration, type NewGenerationBatch } from '@/database/schemas';
import { checkUsageLimit } from '@/server/modules/billing/checkUsageLimit';
import { fetchRate } from '@/server/services/billing/rates-source';
import { type CreateImageServicePayload } from '@/server/routers/lambda/image';

interface ChargeParams {
  clientIp?: string | null;
  configForDatabase: CreateImageServicePayload['params'];
  generationParams: CreateImageServicePayload['params'];
  generationTopicId: string;
  imageNum: number;
  model: string;
  provider: string;
  userId: string;
}

type ChargeResult =
  | undefined
  | {
      data: {
        batch: NewGenerationBatch;
        generations: NewGeneration[];
      };
      success: true;
    };

export async function chargeBeforeGenerate(params: ChargeParams): Promise<ChargeResult> {
  const db = await getServerDB();

  // Strict mode: image model must have an explicit row with pricing_unit='image'.
  // Never fall through to __default__ (token pricing can't bill per-image).
  const rate = await fetchRate(params.model);
  if (!rate || rate.modelId === '__default__' || rate.pricingUnit !== 'image') {
    throw new Error(
      `Model "${params.model}" is not configured for image generation. Admin: add it at /admin/finance/models.`,
    );
  }
  if (!rate.isActive) {
    throw new Error(`Model "${params.model}" is disabled.`);
  }

  const result = await checkUsageLimit(db, params.userId, params.model);
  if (!result.allowed) {
    console.warn(`[billing] Image generation blocked for user ${params.userId}: ${result.message}`);
    throw new Error(result.message || 'Usage limit exceeded');
  }

  return undefined;
}
```

- [ ] **Step 2: Add strict pricing_unit validation in chargeBeforeGenerate (video)**

Replace `src/business/server/video-generation/chargeBeforeGenerate.ts` with same pattern but `pricing_unit='second'`:

```typescript
import { getServerDB } from '@/database/core/db-adaptor';
import type { NewGeneration, NewGenerationBatch } from '@/database/schemas';
import { checkUsageLimit } from '@/server/modules/billing/checkUsageLimit';
import { fetchRate } from '@/server/services/billing/rates-source';
import type { CreateVideoServicePayload } from '@/server/routers/lambda/video';

interface ChargeParams {
  generationTopicId: string;
  model: string;
  params: CreateVideoServicePayload['params'];
  provider: string;
  userId: string;
}

interface ErrorBatch {
  data: {
    batch: NewGenerationBatch;
    generations: NewGeneration[];
  };
  success: true;
}

interface ChargeBeforeResult {
  errorBatch?: ErrorBatch;
  prechargeResult?: Record<string, unknown>;
}

export async function chargeBeforeGenerate(params: ChargeParams): Promise<ChargeBeforeResult> {
  const db = await getServerDB();

  const rate = await fetchRate(params.model);
  if (!rate || rate.modelId === '__default__' || rate.pricingUnit !== 'second') {
    throw new Error(
      `Model "${params.model}" is not configured for video generation. Admin: add it at /admin/finance/models.`,
    );
  }
  if (!rate.isActive) {
    throw new Error(`Model "${params.model}" is disabled.`);
  }

  const result = await checkUsageLimit(db, params.userId, params.model);
  if (!result.allowed) {
    console.warn(`[billing] Video generation blocked for user ${params.userId}: ${result.message}`);
    throw new Error(result.message || 'Usage limit exceeded');
  }

  return {};
}
```

- [ ] **Step 3: Refactor image chargeAfterGenerate to use Usage + async credit calc**

Replace `src/business/server/image-generation/chargeAfterGenerate.ts`:

```typescript
import { getServerDB } from '@/database/core/db-adaptor';
import { BillingService } from '@/server/services/billing';
import { writeUsageLog } from '@/server/modules/analytics/writeUsageLog';
import { calculateCreditsAsync } from '@/server/modules/billing/model-rates';
import { type ModelPerformance, type ModelUsage } from '@/types/index';

interface ChargeParams {
  metadata: {
    asyncTaskId: string;
    generationBatchId: string;
    modelId: string;
    topicId?: string;
  };
  metrics?: ModelPerformance;
  modelUsage?: ModelUsage;
  imageNum?: number;
  provider: string;
  userId: string;
}

export async function chargeAfterGenerate(params: ChargeParams): Promise<void> {
  const imageNum = params.imageNum ?? 1;
  if (imageNum <= 0) return;

  const db = await getServerDB();
  const credits = await calculateCreditsAsync(params.metadata.modelId, {
    kind: 'image',
    images: imageNum,
  });

  await new BillingService(db, params.userId).incrementTokensUsed(credits);

  await writeUsageLog(db, {
    userId: params.userId,
    model: params.metadata.modelId,
    provider: params.provider || 'unknown',
    inputTokens: 0,
    outputTokens: 0,
    creditsCharged: credits,
    kind: 'image',
  });

  console.info(
    `[billing] image charged ${credits} credits: user=${params.userId} model=${params.metadata.modelId} images=${imageNum}`,
  );
}
```

- [ ] **Step 4: Refactor video chargeAfterGenerate similarly**

Replace `src/business/server/video-generation/chargeAfterGenerate.ts`:

```typescript
import { getServerDB } from '@/database/core/db-adaptor';
import { BillingService } from '@/server/services/billing';
import { writeUsageLog } from '@/server/modules/analytics/writeUsageLog';
import { calculateCreditsAsync } from '@/server/modules/billing/model-rates';

interface ChargeParams {
  computePriceParams?: { generateAudio?: boolean };
  isError?: boolean;
  latency?: number;
  metadata: {
    asyncTaskId: string;
    generationBatchId: string;
    modelId: string;
    topicId?: string;
  };
  model: string;
  prechargeResult?: Record<string, unknown>;
  provider: string;
  // Video: use durationSeconds from provider webhook if available, else fall back
  // to duration in modelUsage, else 0 (no charge, but we log it).
  usage?: { completionTokens: number; totalTokens: number; durationSeconds?: number };
  userId: string;
}

export async function chargeAfterGenerate(params: ChargeParams): Promise<void> {
  if (params.isError) return;

  const seconds = params.usage?.durationSeconds ?? 0;
  if (seconds <= 0) {
    console.warn(
      `[billing] video chargeAfter: no durationSeconds for model=${params.metadata.modelId}, skipping charge`,
    );
    return;
  }

  const db = await getServerDB();
  const credits = await calculateCreditsAsync(params.metadata.modelId, {
    kind: 'video',
    videoSeconds: seconds,
  });

  await new BillingService(db, params.userId).incrementTokensUsed(credits);

  await writeUsageLog(db, {
    userId: params.userId,
    model: params.metadata.modelId,
    provider: params.provider || 'unknown',
    inputTokens: 0,
    outputTokens: 0,
    creditsCharged: credits,
    kind: 'video',
  });

  console.info(
    `[billing] video charged ${credits} credits: user=${params.userId} model=${params.metadata.modelId} seconds=${seconds}`,
  );
}
```

- [ ] **Step 5: Type check**

```bash
npx tsc --noEmit 2>&1 | grep -E "image-generation|video-generation" | head
```
Expected: empty.

- [ ] **Step 6: Commit**

```bash
git add src/business/server/image-generation src/business/server/video-generation
git -c user.name=pasha -c user.email=2396741@gmail.com commit -m "feat(billing): strict pricing_unit gate + Usage-shaped charge for image/video"
git push origin canary
```

---

## Task 9: Update `/webapi/admin/model-rates` — GET reads DB, add POST/PUT/DELETE for admin

**Files:**
- Modify: `src/app/(backend)/webapi/admin/model-rates/route.ts`

- [ ] **Step 1: Replace GET with DB-backed implementation + add write endpoints**

```typescript
// src/app/(backend)/webapi/admin/model-rates/route.ts
import { NextRequest, NextResponse } from 'next/server';

import { TIER_DAILY_CAPS } from '@/server/modules/billing/checkUsageLimit';
import { CREDIT_VALUE_RUB, USD_TO_RUB } from '@/server/modules/billing/model-rates';
import {
  PLAN_MAX_TIER,
  classifyModelTierAsync,
  getRequiredPlanForModelAsync,
  invalidateRatesCache,
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
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Accept-Profile': 'ai_aggregator',
      'Content-Profile': 'ai_aggregator',
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
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
      tier: await classifyModelTierAsync(r.modelId),
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
```

- [ ] **Step 2: Probe endpoint after next deploy**

Deferred to Task 11 (one deploy after all refactor).

- [ ] **Step 3: Commit**

```bash
git add src/app/\(backend\)/webapi/admin/model-rates/route.ts
git -c user.name=pasha -c user.email=2396741@gmail.com commit -m "feat(admin-api): model-rates endpoint GET/POST/PUT/DELETE, cache invalidation on write"
git push origin canary
```

---

## Task 10: Admin UI — editable modal + cost preview

**Files:**
- Modify: `app/(admin)/finance/models/page.tsx` (webgpt-admin)
- Modify: `app/(admin)/finance/models/_components/models-client.tsx`
- Create: `app/(admin)/finance/models/_components/rate-editor-modal.tsx`
- Create: `app/api/model-rates/route.ts` (admin-side proxy)

All paths under `/home/deploy/projects/webgpt-admin/`.

- [ ] **Step 1: Create admin API proxy**

`app/api/model-rates/route.ts`:

```typescript
import { getAdminUser } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';

const AGG = process.env.AGGREGATOR_API_URL || 'https://ask.gptweb.ru';
const CRON = process.env.CRON_SECRET!;

async function forward(method: string, url: string, body?: unknown) {
  return fetch(url, {
    method,
    headers: { Authorization: `Bearer ${CRON}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function POST(request: NextRequest) {
  if (!(await getAdminUser())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json();
  const res = await forward('POST', `${AGG}/webapi/admin/model-rates`, body);
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function PUT(request: NextRequest) {
  if (!(await getAdminUser())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json();
  const res = await forward('PUT', `${AGG}/webapi/admin/model-rates`, body);
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function DELETE(request: NextRequest) {
  if (!(await getAdminUser())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const modelId = request.nextUrl.searchParams.get('model_id');
  if (!modelId) return NextResponse.json({ error: 'model_id required' }, { status: 400 });
  const res = await forward(
    'DELETE',
    `${AGG}/webapi/admin/model-rates?model_id=${encodeURIComponent(modelId)}`,
  );
  return NextResponse.json(await res.json(), { status: res.status });
}
```

- [ ] **Step 2: Create edit modal component**

`app/(admin)/finance/models/_components/rate-editor-modal.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

export type PricingUnit = 'tokens' | 'image' | 'second';

export interface RateDraft {
  model_id: string;
  provider: string;
  pricing_unit: PricingUnit;
  input_per_1m: number | null;
  output_per_1m: number | null;
  per_unit: number | null;
  markup: number;
  tier_override: string | null;
  is_active: boolean;
  notes: string | null;
  isNew?: boolean;
}

const EMPTY: RateDraft = {
  model_id: '',
  provider: '',
  pricing_unit: 'tokens',
  input_per_1m: 0,
  output_per_1m: 0,
  per_unit: null,
  markup: 3,
  tier_override: null,
  is_active: true,
  notes: '',
  isNew: true,
};

function CostPreview({ draft }: { draft: RateDraft }) {
  const [tokensIn, setTokensIn] = useState(1000);
  const [tokensOut, setTokensOut] = useState(500);
  const [images, setImages] = useState(1);
  const [seconds, setSeconds] = useState(10);

  let usdRaw = 0;
  if (draft.pricing_unit === 'tokens') {
    usdRaw =
      (tokensIn / 1_000_000) * (draft.input_per_1m ?? 0) +
      (tokensOut / 1_000_000) * (draft.output_per_1m ?? 0);
  } else if (draft.pricing_unit === 'image') {
    usdRaw = images * (draft.per_unit ?? 0);
  } else {
    usdRaw = seconds * (draft.per_unit ?? 0);
  }
  const usdMarked = usdRaw * (draft.markup ?? 0);
  const rub = usdMarked * 100;
  const credits = Math.max(1, Math.ceil(rub / 0.15));

  return (
    <div className="rounded-md border p-3 bg-muted/30 text-xs space-y-2">
      <div className="font-medium">Cost preview</div>
      {draft.pricing_unit === 'tokens' && (
        <div className="flex gap-2 items-center">
          <Label className="text-xs">in</Label>
          <Input
            type="number"
            className="h-7 w-24"
            value={tokensIn}
            onChange={(e) => setTokensIn(parseInt(e.target.value) || 0)}
          />
          <Label className="text-xs">out</Label>
          <Input
            type="number"
            className="h-7 w-24"
            value={tokensOut}
            onChange={(e) => setTokensOut(parseInt(e.target.value) || 0)}
          />
        </div>
      )}
      {draft.pricing_unit === 'image' && (
        <div className="flex gap-2 items-center">
          <Label className="text-xs">images</Label>
          <Input
            type="number"
            className="h-7 w-24"
            value={images}
            onChange={(e) => setImages(parseInt(e.target.value) || 0)}
          />
        </div>
      )}
      {draft.pricing_unit === 'second' && (
        <div className="flex gap-2 items-center">
          <Label className="text-xs">seconds</Label>
          <Input
            type="number"
            className="h-7 w-24"
            value={seconds}
            onChange={(e) => setSeconds(parseInt(e.target.value) || 0)}
          />
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        <div>
          raw: <span className="font-mono">${usdRaw.toFixed(6)}</span>
        </div>
        <div>
          × markup: <span className="font-mono">${usdMarked.toFixed(6)}</span>
        </div>
        <div>
          credits: <span className="font-mono">{credits}</span>
        </div>
      </div>
    </div>
  );
}

export function RateEditorModal({
  draft,
  open,
  onClose,
  onSaved,
}: {
  draft: RateDraft | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [edit, setEdit] = useState<RateDraft>(draft ?? EMPTY);
  const [saving, setSaving] = useState(false);

  const update = <K extends keyof RateDraft>(key: K, value: RateDraft[K]) =>
    setEdit((prev) => ({ ...prev, [key]: value }));

  const save = async () => {
    if (!edit.model_id.trim() || !edit.provider.trim()) {
      toast.error('model_id и provider обязательны');
      return;
    }
    setSaving(true);
    const method = edit.isNew ? 'POST' : 'PUT';
    const res = await fetch('/admin/api/model-rates', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(edit),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? res.statusText);
      return;
    }
    toast.success(edit.isNew ? 'Создано' : 'Обновлено');
    onSaved();
    onClose();
  };

  const remove = async () => {
    if (edit.model_id === '__default__') {
      toast.error('__default__ нельзя удалить');
      return;
    }
    if (!confirm(`Удалить ${edit.model_id}?`)) return;
    const res = await fetch(
      `/admin/api/model-rates?model_id=${encodeURIComponent(edit.model_id)}`,
      { method: 'DELETE' },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? res.statusText);
      return;
    }
    toast.success('Удалено');
    onSaved();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{edit.isNew ? 'Новая модель' : `Редактирование: ${edit.model_id}`}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>model_id</Label>
              <Input
                value={edit.model_id}
                onChange={(e) => update('model_id', e.target.value)}
                disabled={!edit.isNew}
              />
            </div>
            <div>
              <Label>provider</Label>
              <Input value={edit.provider} onChange={(e) => update('provider', e.target.value)} />
            </div>
          </div>

          <div>
            <Label>pricing_unit</Label>
            <Select
              value={edit.pricing_unit}
              onValueChange={(v) => update('pricing_unit', v as PricingUnit)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tokens">tokens (chat)</SelectItem>
                <SelectItem value="image">image (per-image)</SelectItem>
                <SelectItem value="second">second (video, per-second)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {edit.pricing_unit === 'tokens' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>input_per_1m (USD)</Label>
                <Input
                  type="number"
                  step="0.0001"
                  value={edit.input_per_1m ?? ''}
                  onChange={(e) => update('input_per_1m', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div>
                <Label>output_per_1m (USD)</Label>
                <Input
                  type="number"
                  step="0.0001"
                  value={edit.output_per_1m ?? ''}
                  onChange={(e) => update('output_per_1m', parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>
          )}

          {(edit.pricing_unit === 'image' || edit.pricing_unit === 'second') && (
            <div>
              <Label>
                per_unit (USD per {edit.pricing_unit === 'image' ? 'image' : 'second'})
              </Label>
              <Input
                type="number"
                step="0.0001"
                value={edit.per_unit ?? ''}
                onChange={(e) => update('per_unit', parseFloat(e.target.value) || 0)}
              />
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>markup (×)</Label>
              <Input
                type="number"
                step="0.01"
                value={edit.markup}
                onChange={(e) => update('markup', parseFloat(e.target.value) || 0)}
              />
            </div>
            <div>
              <Label>tier_override</Label>
              <Select
                value={edit.tier_override ?? '__auto__'}
                onValueChange={(v) => update('tier_override', v === '__auto__' ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__auto__">(авто)</SelectItem>
                  <SelectItem value="cheap">cheap</SelectItem>
                  <SelectItem value="mid">mid</SelectItem>
                  <SelectItem value="high">high</SelectItem>
                  <SelectItem value="premium">premium</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Switch
                checked={edit.is_active}
                onCheckedChange={(v) => update('is_active', v)}
              />
              <Label>is_active</Label>
            </div>
          </div>

          <div>
            <Label>notes</Label>
            <Textarea
              rows={2}
              value={edit.notes ?? ''}
              onChange={(e) => update('notes', e.target.value)}
              placeholder="Что угодно для админа — причина изменений, дата обновления цен провайдером..."
            />
          </div>

          <CostPreview draft={edit} />
        </div>

        <DialogFooter>
          {!edit.isNew && edit.model_id !== '__default__' && (
            <Button variant="destructive" onClick={remove} className="mr-auto">
              Удалить
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Wire modal into table**

Edit `app/(admin)/finance/models/_components/models-client.tsx` — add modal state and row onClick. Key delta:

```typescript
// At top of ModelsClient():
import { RateEditorModal, type RateDraft } from './rate-editor-modal';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';

// Add state:
const [editing, setEditing] = useState<RateDraft | null>(null);

// Add a top-row "Добавить модель" button near the tier filter:
<Button onClick={() => setEditing({ /* EMPTY preset from modal */ model_id: '', provider: '', pricing_unit: 'tokens', input_per_1m: 0, output_per_1m: 0, per_unit: null, markup: 3, tier_override: null, is_active: true, notes: '', isNew: true })}>
  <Plus className="h-4 w-4 mr-2" /> Новая модель
</Button>

// Make each TableRow clickable:
<TableRow key={m.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setEditing({
  model_id: m.id,
  provider: m.provider,
  pricing_unit: m.pricingUnit ?? 'tokens',
  input_per_1m: m.inputPer1M,
  output_per_1m: m.outputPer1M,
  per_unit: m.perUnit ?? null,
  markup: m.markup ?? 3,
  tier_override: m.tierOverride ?? null,
  is_active: m.isActive ?? true,
  notes: m.notes ?? '',
  isNew: false,
})}>
  {/* existing cells */}
</TableRow>

// Render modal at end of component:
<RateEditorModal
  draft={editing}
  open={editing !== null}
  onClose={() => setEditing(null)}
  onSaved={() => {
    // full page reload — simplest; ISR will re-fetch model-rates
    window.location.reload();
  }}
/>
```

Also extend `ModelRatesResponse` and the `models` map to include: `pricingUnit`, `inputPer1M`, `outputPer1M`, `perUnit`, `markup`, `tierOverride`, `isActive`, `notes`. These fields come from the aggregator's updated `/webapi/admin/model-rates` GET (Task 9).

- [ ] **Step 4: Commit**

```bash
cd /home/deploy/projects/webgpt-admin
git add app/api/model-rates app/\(admin\)/finance/models
git -c user.name=pasha -c user.email=2396741@gmail.com commit -m "feat(admin): editable /admin/finance/models with cost preview modal"
git push origin master
```

---

## Task 11: Build, deploy, smoke

**Files:** None — pipeline run.

- [ ] **Step 1: Build both**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat && nohup docker build -t lobechat-custom:latest . > /tmp/agg-build.log 2>&1 & echo "agg pid $!"
cd /home/deploy/projects/webgpt-admin && nohup docker build -t webgpt-admin:latest . > /tmp/adm-build.log 2>&1 & echo "adm pid $!"
```

- [ ] **Step 2: Wait + verify compilation**

```bash
until ! pgrep -f "docker build" >/dev/null; do sleep 30; done
grep -E "Compiled successfully|Failed|error TS" /tmp/agg-build.log /tmp/adm-build.log | tail -10
```
Expected: both "Compiled successfully" lines present; no "Failed" / "error TS".

- [ ] **Step 3: Recreate containers**

```bash
cd /opt/lobechat && docker compose up -d --force-recreate lobe webgpt-admin
```

- [ ] **Step 4: Probe aggregator endpoint**

```bash
SECRET=$(grep ^CRON_SECRET /opt/lobechat/.env | cut -d= -f2)
curl -s "https://ask.gptweb.ru/webapi/admin/model-rates" -H "Authorization: Bearer $SECRET" | python3 -m json.tool | head -50
```
Expected: JSON with `models` array of 31 entries, `defaultRate` non-null, `counts.total=31`.

- [ ] **Step 5: Smoke — a real chat request (manual via UI)**

Open https://ask.gptweb.ru, sign in, send a chat message with gpt-5-mini. Then:

```bash
docker logs lobehub --since 2m 2>&1 | grep -E "\[billing\] charged|\[analytics\] usage_logs OK"
```
Expected: **both** lines present with cost_usd ~3x old expected (markup applied).

- [ ] **Step 6: Verify cost math**

```bash
docker exec lobe-postgres psql -U postgres -d lobechat -c "SELECT model, cost_usd, credits_charged FROM usage_logs ORDER BY created_at DESC LIMIT 3;"
```
Compare to Task 1 baseline: for same input/output token counts, new `cost_usd` should be ≈ 3 × old cost_usd. If equal → markup not applied → rollback.

---

## Task 12: Remove hardcoded `MODEL_RATES` catalog (cleanup)

**Files:**
- Modify: `src/server/modules/billing/model-rates.ts` (keep constants, drop catalog)

- [ ] **Step 1: Verify nothing imports MODEL_RATES or getModelRate**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
grep -rn "MODEL_RATES\|getModelRate\b" src/ | grep -v "rates-source\|compute-cost\|model-rates.ts\|test"
```
Expected: only references inside `scripts/billing/seed-model-rates.ts`.

- [ ] **Step 2: Strip the catalog**

Edit `src/server/modules/billing/model-rates.ts`. Remove:
- The `rates` object (lines ~20-67)
- The `openRouterPrefixes` object (lines ~70-100)
- The loop that builds `MODEL_RATES` (lines ~105-109)
- `export function getModelRate` (lines ~114-116)
- `ModelRate` interface
- `DEFAULT_MODEL_RATE` export (now only in DB)

Keep:
- `CREDIT_VALUE_RUB`, `USD_TO_RUB` constants
- `calculateCreditsAsync` (needs `USD_TO_RUB`, `CREDIT_VALUE_RUB`)
- `TokenBreakdown` interface — move to `compute-cost.ts` and re-export if still used elsewhere
- `estimateCreditsPerMessage` and `tokensToCredits` — deprecate if unused, else rewrite to be async

Final file should be ~30 lines.

- [ ] **Step 3: Fix the seed script — read from local const fallback**

`scripts/billing/seed-model-rates.ts` imported `MODEL_RATES`. It's a CLI seed — inline the constant there instead of importing:

```typescript
// Replace `import { MODEL_RATES } from '../../src/server/modules/billing/model-rates';`
// with a local copy:
const MODEL_RATES_SEED: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  'deepseek-chat': { inputPer1M: 0.32, outputPer1M: 0.89 },
  // ... paste the full table from the pre-cleanup model-rates.ts ...
};
// Then use MODEL_RATES_SEED everywhere instead of MODEL_RATES.
```

- [ ] **Step 4: Type check + tests**

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | head
pnpm vitest run src/server/modules/billing src/server/services/billing
```
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/billing/model-rates.ts scripts/billing/seed-model-rates.ts
git -c user.name=pasha -c user.email=2396741@gmail.com commit -m "chore(billing): drop hardcoded MODEL_RATES, rates-source is source of truth"
git push origin canary
```

- [ ] **Step 6: Final deploy**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat && docker build -t lobechat-custom:latest . 2>&1 | tail -3
cd /opt/lobechat && docker compose up -d --force-recreate lobe
```

---

## Done

After Task 12 the catalog lives entirely in `ai_aggregator.model_rates`. Adding a new model = one row via the admin modal, no redeploy. Rates sync to aggregator within 60s through the rates-source cache; write-side invalidation makes it instant for the current container.

Follow-up specs (not this plan):
- Annual billing with 55% discount
- Top-up packs with overage markup
- Welcome bonus 100 credits on signup
- Public coefficient page (Chad AI-style transparency)
