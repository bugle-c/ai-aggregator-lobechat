-- Preset platform Ф2 (deferred item): editorial pin for the home-page rows.
-- The home sections ask `presets.list` for `featured = true` first and fill
-- the rest of the row from the regular ranking, so with nothing pinned the
-- page behaves exactly as before. Pinned by hand (SQL) until an admin page
-- exists: UPDATE presets SET featured = true WHERE slug IN (...).
ALTER TABLE "presets" ADD COLUMN IF NOT EXISTS "featured" boolean DEFAULT false NOT NULL;
