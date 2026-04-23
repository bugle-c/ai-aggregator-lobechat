-- Migration: 0001_model_rates
-- Applied to prod Supabase (supabase.pashavin.ru, schema ai_aggregator) on 2026-04-23.
-- Part of the Unified Credit Rates refactor; see
--   docs/plans/2026-04-23-unified-credit-rates-plan.md
--   docs/plans/2026-04-23-unified-credit-rates-design.md
-- This table is the single source of truth for per-model pricing (input/output
-- per 1M tokens or per-unit for image/second), markup multiplier, and optional
-- tier overrides. Future tasks (seed script, API, admin UI, billing integration)
-- depend on this DDL being present.

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
