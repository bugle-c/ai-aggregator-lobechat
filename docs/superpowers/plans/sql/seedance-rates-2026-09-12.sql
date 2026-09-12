-- Seedance 2.0 family: per_unit = real WaveSpeed 720p price per second (docs 2026-09-12);
-- other resolutions are scaled in code (RESOLUTION_PRICE_FACTORS: 480p ×0.5, 1080p ×2.5, 4k ×5).
-- Operator step: run against Supabase AFTER the code that applies the factors is deployed,
-- otherwise 1080p would be charged at the 720p price in between.
UPDATE ai_aggregator.model_rates SET per_unit = 0.20, tier_override = 'high', updated_at = now(),
  notes = coalesce(notes,'') || ' | 2026-09-12: per_unit = 720p price (was 1080p 0.50); resolution factors in code'
  WHERE model_id LIKE 'bytedance/seedance-2.0-fast/%';
UPDATE ai_aggregator.model_rates SET per_unit = 0.24, tier_override = 'high', updated_at = now(),
  notes = coalesce(notes,'') || ' | 2026-09-12: per_unit = 720p price; resolution factors in code'
  WHERE model_id LIKE 'bytedance/seedance-2.0/%';
INSERT INTO ai_aggregator.model_rates (model_id, provider, pricing_unit, per_unit, markup, tier_override, is_active, notes)
VALUES
  ('bytedance/seedance-2.0-mini/text-to-video',  'wavespeed', 'second', 0.12, 3.50, 'mid', true, 'Seedance 2.0 Mini — low-cost entry (Basic); per_unit = 720p, resolution factors in code (2026-09-12)'),
  ('bytedance/seedance-2.0-mini/image-to-video', 'wavespeed', 'second', 0.12, 3.50, 'mid', true, 'Seedance 2.0 Mini I2V (paired endpoint); per_unit = 720p (2026-09-12)')
ON CONFLICT (model_id) DO UPDATE SET per_unit = EXCLUDED.per_unit, tier_override = EXCLUDED.tier_override, is_active = true, updated_at = now();
