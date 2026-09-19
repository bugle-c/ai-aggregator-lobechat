-- Preset platform: remember which model made the donor's original, so the
-- recommended model can follow it (GPT Image / Midjourney / Nano Banana for
-- images; Seedance / Veo / Kling / Wan for videos) and be re-derived later.
ALTER TABLE "presets" ADD COLUMN IF NOT EXISTS "source_model" text;
