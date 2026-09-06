-- Preset platform Ф1: attribution + poster columns.
-- All nullable (or defaulted) so existing hand-curated rows need no backfill.
ALTER TABLE "presets"
  ADD COLUMN "external_id" text,
  ADD COLUMN "source_platform" text,
  ADD COLUMN "source_url" text,
  ADD COLUMN "author_name" text,
  ADD COLUMN "author_url" text,
  ADD COLUMN "author_avatar" text,
  ADD COLUMN "poster_url" text,
  ADD COLUMN "popularity" integer,
  ADD COLUMN "requires_image" boolean DEFAULT false NOT NULL,
  ADD COLUMN "ingested_at" timestamp with time zone,
  ADD COLUMN "license" text;
--> statement-breakpoint
-- Dedup key for the ingest pipeline. Unique index rather than a UNIQUE
-- constraint so multiple NULLs (hand-curated presets) stay allowed.
CREATE UNIQUE INDEX IF NOT EXISTS "presets_external_id_key" ON "presets" ("external_id");
