-- Preset platform Ф2: Russian-capable preset search.
--
-- `presets.list` used to match `title ILIKE '%q%'` only. None of the 76
-- hand-curated titles contain Cyrillic, so any Russian query returned
-- "Пресеты не найдены". Search now covers title, description, category and
-- author_name, and every column gets a trigram index so a leading-wildcard
-- LIKE stays index-backed as the ingest cron grows the catalogue past 1000
-- rows.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
-- The indexed expression MUST match `searchable()` in
-- src/business/server/lambda-routers/presets.ts verbatim, otherwise postgres
-- silently falls back to a sequential scan.
--   lower()    — case folding, Cyrillic included
--   translate() — folds «ё» onto «е», the one accent distinction that matters
--                 in Russian ("ёлка" must match a search for "елка")
CREATE INDEX IF NOT EXISTS "presets_title_trgm_idx"
  ON "presets" USING gin (translate(lower("title"), 'ё', 'е') gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "presets_description_trgm_idx"
  ON "presets" USING gin (translate(lower("description"), 'ё', 'е') gin_trgm_ops);
--> statement-breakpoint
-- category and author_name are short, but they are ORed into the same
-- predicate: without an index on every branch the planner drops the whole
-- bitmap-OR plan and seq-scans anyway.
CREATE INDEX IF NOT EXISTS "presets_category_trgm_idx"
  ON "presets" USING gin (translate(lower("category"), 'ё', 'е') gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "presets_author_name_trgm_idx"
  ON "presets" USING gin (translate(lower("author_name"), 'ё', 'е') gin_trgm_ops);
