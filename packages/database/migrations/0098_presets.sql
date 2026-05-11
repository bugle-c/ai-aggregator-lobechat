-- 0098_presets.sql
--
-- Higgsfield-style preset library for /image and /video flows.
-- Each preset binds to a specific model_id and carries a prompt_template
-- + params_lock + a preview MP4 URL. Seeded with 4 video categories
-- (camera/effects/character/ambient) and 5 image categories
-- (portrait/landscape/anime/realistic/product). Preview URLs are
-- placeholders pointing at https://files.gptweb.ru/lobe/presets/<slug>.mp4
-- — actual MP4s are uploaded later (Task 19).
--
-- model_id values must match existing model registry slugs. The plan
-- listed canonical placeholders (seedance-2-0, kling-3-0, nano-banana-pro,
-- flux-pro); these were resolved against packages/model-bank/src/aiModels
-- to:
--   - bytedance/seedance-2.0-fast/text-to-video      (was seedance-2-0)
--   - kwaivgi/kling-v3.0-pro/text-to-video           (was kling-3-0)
--   - google/nano-banana-pro/text-to-image           (was nano-banana-pro)
--   - flux-pro                                       (matches bfl.ts)

CREATE TABLE IF NOT EXISTS "presets" (
  "id"              BIGSERIAL PRIMARY KEY,
  "slug"            TEXT NOT NULL UNIQUE,
  "modality"        TEXT NOT NULL CHECK ("modality" IN ('image','video')),
  "model_id"        TEXT NOT NULL,
  "category"        TEXT NOT NULL,
  "title"           TEXT NOT NULL,
  "description"     TEXT,
  "prompt_template" TEXT NOT NULL,
  "params_lock"     JSONB NOT NULL DEFAULT '{}'::jsonb,
  "preview_url"     TEXT NOT NULL,
  "badges"          TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  "sort_order"      INTEGER NOT NULL DEFAULT 0,
  "active"          BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "presets_modality_model_idx"
  ON "presets" ("modality", "model_id", "category", "sort_order")
  WHERE "active" = TRUE;

-- ============ VIDEO PRESETS (12) ============
INSERT INTO "presets"
  ("slug", "modality", "model_id", "category", "title", "description", "prompt_template", "params_lock", "preview_url", "badges", "sort_order")
VALUES
  -- Camera (4)
  ('crash-zoom-in', 'video', 'bytedance/seedance-2.0-fast/text-to-video', 'camera',
   'Crash Zoom In', 'Резкий приближающий зум',
   'Crash zoom into {{user_prompt}}, cinematic, sharp focus, 24fps motion blur',
   '{"aspect_ratio":"16:9","duration_sec":5}'::jsonb,
   'https://files.gptweb.ru/lobe/presets/crash-zoom-in.mp4',
   ARRAY['top_choice','trending'], 10),

  ('earth-zoom-out', 'video', 'bytedance/seedance-2.0-fast/text-to-video', 'camera',
   'Earth Zoom Out', 'Зум от объекта до Земли',
   'Slow zoom out from {{user_prompt}} all the way to outer space view of Earth',
   '{"aspect_ratio":"16:9","duration_sec":6}'::jsonb,
   'https://files.gptweb.ru/lobe/presets/earth-zoom-out.mp4',
   ARRAY['top_choice'], 20),

  ('bullet-time', 'video', 'kwaivgi/kling-v3.0-pro/text-to-video', 'camera',
   'Bullet Time', 'Замедление 360° вокруг объекта',
   '{{user_prompt}}, frozen in time, camera orbits 360 degrees, Matrix-style bullet time',
   '{"aspect_ratio":"16:9","duration_sec":4}'::jsonb,
   'https://files.gptweb.ru/lobe/presets/bullet-time.mp4',
   ARRAY['trending'], 30),

  ('arc-left', 'video', 'kwaivgi/kling-v3.0-pro/text-to-video', 'camera',
   'Arc Left', 'Дуга движения камеры влево',
   'Camera arcs smoothly leftward around {{user_prompt}}, parallax effect',
   '{"aspect_ratio":"16:9","duration_sec":5}'::jsonb,
   'https://files.gptweb.ru/lobe/presets/arc-left.mp4',
   ARRAY[]::text[], 40),

  -- Effects (4)
  ('building-explosion', 'video', 'bytedance/seedance-2.0-fast/text-to-video', 'effects',
   'Building Explosion', 'Кинематографичный взрыв',
   '{{user_prompt}}, building explodes in slow motion, fire and debris, IMAX style',
   '{"aspect_ratio":"16:9","duration_sec":5}'::jsonb,
   'https://files.gptweb.ru/lobe/presets/building-explosion.mp4',
   ARRAY['top_choice'], 110),

  ('turning-metal-melting', 'video', 'bytedance/seedance-2.0-fast/text-to-video', 'effects',
   'Turning Metal × Melting', 'Превращение в текучий металл',
   '{{user_prompt}}, transforming into liquid molten metal, surface ripples',
   '{}'::jsonb,
   'https://files.gptweb.ru/lobe/presets/turning-metal-melting.mp4',
   ARRAY['mixed'], 120),

  ('face-punch', 'video', 'kwaivgi/kling-v3.0-pro/text-to-video', 'effects',
   'Face Punch', 'Удар в лицо в slow-mo',
   '{{user_prompt}}, gets punched in the face, slow motion impact, droplets fly',
   '{"aspect_ratio":"16:9"}'::jsonb,
   'https://files.gptweb.ru/lobe/presets/face-punch.mp4',
   ARRAY['top_choice','trending'], 130),

  ('car-explosion', 'video', 'bytedance/seedance-2.0-fast/text-to-video', 'effects',
   'Car Explosion', 'Взрыв авто и пламя',
   '{{user_prompt}}, car explodes with fireball, debris flying outward',
   '{"aspect_ratio":"16:9","duration_sec":5}'::jsonb,
   'https://files.gptweb.ru/lobe/presets/car-explosion.mp4',
   ARRAY[]::text[], 140),

  -- Character (2)
  ('action-run', 'video', 'kwaivgi/kling-v3.0-pro/text-to-video', 'character',
   'Action Run', 'Динамичный бег героя',
   '{{user_prompt}}, running heroically toward camera, slow-motion strides',
   '{"aspect_ratio":"16:9"}'::jsonb,
   'https://files.gptweb.ru/lobe/presets/action-run.mp4',
   ARRAY['top_choice'], 210),

  ('eyes-in', 'video', 'bytedance/seedance-2.0-fast/text-to-video', 'character',
   'Eyes In', 'Резкий зум в глаз',
   'Extreme close-up zoom into the eye of {{user_prompt}}',
   '{}'::jsonb,
   'https://files.gptweb.ru/lobe/presets/eyes-in.mp4',
   ARRAY['new'], 220),

  -- Ambient (2)
  ('general-cinematic', 'video', 'bytedance/seedance-2.0-fast/text-to-video', 'ambient',
   'General Cinematic', 'Базовая киношная сцена',
   '{{user_prompt}}, cinematic shot, 35mm film grain, golden hour lighting',
   '{"aspect_ratio":"16:9"}'::jsonb,
   'https://files.gptweb.ru/lobe/presets/general-cinematic.mp4',
   ARRAY[]::text[], 310),

  ('mood-rain', 'video', 'kwaivgi/kling-v3.0-pro/text-to-video', 'ambient',
   'Mood Rain', 'Дождливая атмосфера',
   '{{user_prompt}}, heavy rain, neon reflections on wet ground, moody',
   '{"aspect_ratio":"16:9"}'::jsonb,
   'https://files.gptweb.ru/lobe/presets/mood-rain.mp4',
   ARRAY[]::text[], 320);

-- ============ IMAGE PRESETS (12) ============
INSERT INTO "presets"
  ("slug", "modality", "model_id", "category", "title", "description", "prompt_template", "params_lock", "preview_url", "badges", "sort_order")
VALUES
  -- Portrait (3)
  ('portrait-studio', 'image', 'flux-pro', 'portrait',
   'Studio Portrait', 'Студийный портрет с мягким светом',
   '{{user_prompt}}, professional studio portrait, soft key light, 85mm f/1.4, sharp eyes',
   '{"aspect_ratio":"3:4"}'::jsonb,
   'https://files.gptweb.ru/lobe/presets/portrait-studio.mp4',
   ARRAY['top_choice'], 10),

  ('portrait-noir', 'image', 'flux-pro', 'portrait',
   'Noir Portrait', 'Чёрно-белый драматический',
   '{{user_prompt}}, black and white portrait, hard shadow, film noir lighting',
   '{"aspect_ratio":"3:4"}'::jsonb,
   'https://files.gptweb.ru/lobe/presets/portrait-noir.mp4',
   ARRAY[]::text[], 20),

  ('portrait-anime', 'image', 'google/nano-banana-pro/text-to-image', 'portrait',
   'Anime Portrait', 'Аниме-стиль портрета',
   '{{user_prompt}}, anime style portrait, vivid colors, detailed eyes, cel shading',
   '{"aspect_ratio":"3:4"}'::jsonb,
   'https://files.gptweb.ru/lobe/presets/portrait-anime.mp4',
   ARRAY['trending'], 30),

  -- Landscape (2)
  ('landscape-cinematic', 'image', 'flux-pro', 'landscape',
   'Cinematic Landscape', 'Эпичный пейзаж',
   '{{user_prompt}}, sweeping cinematic landscape, golden hour, anamorphic lens',
   '{"aspect_ratio":"16:9"}'::jsonb,
   'https://files.gptweb.ru/lobe/presets/landscape-cinematic.mp4',
   ARRAY['top_choice'], 110),

  ('landscape-fantasy', 'image', 'flux-pro', 'landscape',
   'Fantasy Landscape', 'Фэнтези-окружение',
   '{{user_prompt}}, fantasy landscape, magical atmosphere, dragons in distance',
   '{"aspect_ratio":"16:9"}'::jsonb,
   'https://files.gptweb.ru/lobe/presets/landscape-fantasy.mp4',
   ARRAY[]::text[], 120),

  -- Anime (2)
  ('anime-shounen', 'image', 'google/nano-banana-pro/text-to-image', 'anime',
   'Shounen Hero', 'Аниме герой shounen',
   '{{user_prompt}}, shounen anime hero, dynamic pose, energy aura, vibrant',
   '{"aspect_ratio":"16:9"}'::jsonb,
   'https://files.gptweb.ru/lobe/presets/anime-shounen.mp4',
   ARRAY['trending'], 210),

  ('anime-ghibli', 'image', 'google/nano-banana-pro/text-to-image', 'anime',
   'Ghibli Soft', 'Мягкий ghibli-style',
   '{{user_prompt}}, Ghibli style, soft watercolor textures, pastel palette',
   '{"aspect_ratio":"16:9"}'::jsonb,
   'https://files.gptweb.ru/lobe/presets/anime-ghibli.mp4',
   ARRAY['top_choice'], 220),

  -- Realistic (3)
  ('realistic-photo', 'image', 'flux-pro', 'realistic',
   'Photo-real', 'Фотореалистичный кадр',
   '{{user_prompt}}, photorealistic, 50mm prime lens, natural lighting, fine details',
   '{}'::jsonb,
   'https://files.gptweb.ru/lobe/presets/realistic-photo.mp4',
   ARRAY['top_choice'], 310),

  ('realistic-product', 'image', 'flux-pro', 'realistic',
   'Product Shot', 'Продуктовая съёмка',
   '{{user_prompt}}, product photography, white seamless backdrop, soft box lighting',
   '{"aspect_ratio":"1:1"}'::jsonb,
   'https://files.gptweb.ru/lobe/presets/realistic-product.mp4',
   ARRAY[]::text[], 320),

  ('realistic-fashion', 'image', 'flux-pro', 'realistic',
   'Fashion Editorial', 'Журнальная мода',
   '{{user_prompt}}, fashion editorial, magazine cover quality, dramatic pose',
   '{"aspect_ratio":"3:4"}'::jsonb,
   'https://files.gptweb.ru/lobe/presets/realistic-fashion.mp4',
   ARRAY['new'], 330),

  -- Product (2)
  ('product-flatlay', 'image', 'flux-pro', 'product',
   'Flat Lay', 'Раскладка сверху',
   '{{user_prompt}}, top-down flat lay composition, even lighting, neutral background',
   '{"aspect_ratio":"1:1"}'::jsonb,
   'https://files.gptweb.ru/lobe/presets/product-flatlay.mp4',
   ARRAY[]::text[], 410),

  ('product-luxury', 'image', 'flux-pro', 'product',
   'Luxury Product', 'Люкс презентация',
   '{{user_prompt}}, luxury product showcase, dark moody background, dramatic rim light',
   '{"aspect_ratio":"1:1"}'::jsonb,
   'https://files.gptweb.ru/lobe/presets/product-luxury.mp4',
   ARRAY['top_choice'], 420);
