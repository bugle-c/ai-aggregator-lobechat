-- Expansion seed: +31 presets across new and existing categories.
--
-- prompt_template authored using the MCSLA formula (Motion · Camera ·
-- Style · Lighting · Action) inspired by the OSideMedia/higgsfield-ai-
-- prompt-skill reference repo. Each template wraps the user prompt
-- between curated style tags so the same {{user_prompt}} input
-- produces visibly different output across presets.
--
-- model_id values match real model-bank entries (verified against
-- packages/model-bank/src/aiModels/wavespeed.ts). preview_url is a
-- placeholder; actual MP4s uploaded in Task 23.
--
-- New categories: 'action' (video) and 'artistic' (image). The
-- frontend category list in src/features/Generators/PRESET_CATEGORIES.ts
-- is updated in the same change set.

-- ============ VIDEO PRESETS (+14) ============
INSERT INTO presets
  (slug, modality, model_id, category, title, description, prompt_template, params_lock, preview_url, badges, sort_order)
VALUES
  -- Camera (4 more)
  ('dolly-zoom-in', 'video', 'bytedance/seedance-2.0-fast/text-to-video', 'camera',
   'Dolly Zoom In', 'Эффект Хичкока — vertigo',
   '{{user_prompt}}, Hitchcock dolly zoom effect, camera moves forward while zooming out, vertigo background warp, telephoto lens, cinematic',
   '{"aspect_ratio":"16:9","duration_sec":5}',
   'https://files.gptweb.ru/lobe/presets/dolly-zoom-in.mp4',
   ARRAY['top_choice'], 50),

  ('360-orbit', 'video', 'kwaivgi/kling-v3.0-pro/text-to-video', 'camera',
   '360 Orbit', 'Облёт камеры вокруг объекта',
   'Camera orbits 360 degrees around {{user_prompt}}, smooth parallax, 60fps motion, cinematic depth of field',
   '{"aspect_ratio":"16:9","duration_sec":6}',
   'https://files.gptweb.ru/lobe/presets/360-orbit.mp4',
   ARRAY['trending'], 60),

  ('fpv-drone', 'video', 'bytedance/seedance-2.0-fast/text-to-video', 'camera',
   'FPV Drone', 'Скоростной полёт от первого лица',
   'FPV drone fly-through around {{user_prompt}}, dynamic swooping motion, wide-angle distortion, ultra-fast pace, action camera footage',
   '{"aspect_ratio":"16:9","duration_sec":5}',
   'https://files.gptweb.ru/lobe/presets/fpv-drone.mp4',
   ARRAY['new','trending'], 70),

  ('crane-up', 'video', 'bytedance/seedance-2.0-fast/text-to-video', 'camera',
   'Crane Up', 'Подъём камеры краном',
   'Camera cranes upward and away from {{user_prompt}}, revealing wider environment, sweeping motion, cinematic establishing shot',
   '{"aspect_ratio":"16:9","duration_sec":6}',
   'https://files.gptweb.ru/lobe/presets/crane-up.mp4',
   ARRAY[]::text[], 80),

  -- Effects (2 more)
  ('water-splash', 'video', 'kwaivgi/kling-v3.0-pro/text-to-video', 'effects',
   'Water Splash', 'Брызги воды slow-mo',
   '{{user_prompt}}, dramatic water splash explosion, 1000fps slow motion, droplets in mid-air, crystal clarity',
   '{"aspect_ratio":"16:9","duration_sec":4}',
   'https://files.gptweb.ru/lobe/presets/water-splash.mp4',
   ARRAY['top_choice'], 150),

  ('glass-shatter', 'video', 'kwaivgi/kling-v3.0-pro/text-to-video', 'effects',
   'Glass Shatter', 'Стекло рассыпается в slow-mo',
   '{{user_prompt}}, glass shatters into thousands of fragments, ultra slow motion, light refraction through shards',
   '{"aspect_ratio":"16:9","duration_sec":4}',
   'https://files.gptweb.ru/lobe/presets/glass-shatter.mp4',
   ARRAY['new'], 160),

  -- Character (2 more)
  ('moonwalk-left', 'video', 'kwaivgi/kling-v3.0-pro/text-to-video', 'character',
   'Moonwalk Left', 'Лунная походка',
   '{{user_prompt}}, doing the moonwalk leftward, smooth gliding motion, retro funk energy, side-view tracking shot',
   '{"aspect_ratio":"16:9","duration_sec":5}',
   'https://files.gptweb.ru/lobe/presets/moonwalk-left.mp4',
   ARRAY[]::text[], 230),

  ('hero-flight', 'video', 'bytedance/seedance-2.0-fast/text-to-video', 'character',
   'Hero Flight', 'Героический полёт',
   '{{user_prompt}}, flying through the sky like a superhero, cape billowing behind, dramatic low-angle shot, epic clouds backdrop',
   '{"aspect_ratio":"16:9","duration_sec":5}',
   'https://files.gptweb.ru/lobe/presets/hero-flight.mp4',
   ARRAY['top_choice','trending'], 240),

  -- Ambient (2 more)
  ('golden-hour-walk', 'video', 'bytedance/seedance-2.0-fast/text-to-video', 'ambient',
   'Golden Hour Walk', 'Прогулка в золотой час',
   '{{user_prompt}}, walking during golden hour, warm sunset backlight, lens flare, dreamy cinematic atmosphere',
   '{"aspect_ratio":"16:9","duration_sec":5}',
   'https://files.gptweb.ru/lobe/presets/golden-hour-walk.mp4',
   ARRAY[]::text[], 330),

  ('neon-night-streets', 'video', 'kwaivgi/kling-v3.0-pro/text-to-video', 'ambient',
   'Neon Night Streets', 'Неоновые ночные улицы',
   '{{user_prompt}}, walking through neon-lit night streets, vivid pink and cyan reflections, cyberpunk Tokyo aesthetic, rain on asphalt',
   '{"aspect_ratio":"16:9","duration_sec":5}',
   'https://files.gptweb.ru/lobe/presets/neon-night-streets.mp4',
   ARRAY['top_choice'], 340),

  -- Action (NEW category, 4)
  ('motorcycle-chase', 'video', 'bytedance/seedance-2.0-fast/text-to-video', 'action',
   'Motorcycle Chase', 'Погоня на мотоциклах',
   '{{user_prompt}}, high-speed motorcycle chase through urban streets, motion blur, tight handheld camera, action-movie energy',
   '{"aspect_ratio":"16:9","duration_sec":5}',
   'https://files.gptweb.ru/lobe/presets/motorcycle-chase.mp4',
   ARRAY['top_choice'], 410),

  ('parkour-leap', 'video', 'kwaivgi/kling-v3.0-pro/text-to-video', 'action',
   'Parkour Leap', 'Прыжок паркур',
   '{{user_prompt}}, parkour leap between rooftops, mid-air pose, slow-motion peak, dynamic camera follow',
   '{"aspect_ratio":"16:9","duration_sec":4}',
   'https://files.gptweb.ru/lobe/presets/parkour-leap.mp4',
   ARRAY['trending'], 420),

  ('sword-fight', 'video', 'kwaivgi/kling-v3.0-pro/text-to-video', 'action',
   'Sword Fight', 'Бой на мечах',
   '{{user_prompt}}, intense sword fight choreography, sparks fly on blade clash, slow-motion strikes, kurosawa-inspired',
   '{"aspect_ratio":"16:9","duration_sec":5}',
   'https://files.gptweb.ru/lobe/presets/sword-fight.mp4',
   ARRAY[]::text[], 430),

  ('dance-spin', 'video', 'bytedance/seedance-2.0-fast/text-to-video', 'action',
   'Dance Spin', 'Танцевальный поворот',
   '{{user_prompt}}, graceful dance spin, fabric and hair flowing, circular camera motion, theatrical lighting',
   '{"aspect_ratio":"16:9","duration_sec":5}',
   'https://files.gptweb.ru/lobe/presets/dance-spin.mp4',
   ARRAY['new'], 440)
ON CONFLICT (slug) DO NOTHING;
--> statement-breakpoint

-- ============ IMAGE PRESETS (+17) ============
INSERT INTO presets
  (slug, modality, model_id, category, title, description, prompt_template, params_lock, preview_url, badges, sort_order)
VALUES
  -- Portrait (3 more)
  ('portrait-cyberpunk', 'image', 'wavespeed-ai/flux-1.1-pro-ultra', 'portrait',
   'Cyberpunk Portrait', 'Киберпанк-портрет',
   '{{user_prompt}}, cyberpunk portrait, neon facial highlights, chrome implants, blade runner atmosphere, vivid color grading',
   '{"aspect_ratio":"3:4"}',
   'https://files.gptweb.ru/lobe/presets/portrait-cyberpunk.mp4',
   ARRAY['trending'], 40),

  ('portrait-renaissance', 'image', 'wavespeed-ai/flux-1.1-pro-ultra', 'portrait',
   'Renaissance Portrait', 'Ренессансный портрет',
   '{{user_prompt}}, Renaissance oil portrait, Rembrandt lighting, baroque costume, dark moody background, classical composition',
   '{"aspect_ratio":"3:4"}',
   'https://files.gptweb.ru/lobe/presets/portrait-renaissance.mp4',
   ARRAY['top_choice'], 50),

  ('portrait-vintage-film', 'image', 'wavespeed-ai/flux-1.1-pro-ultra', 'portrait',
   'Vintage Film', 'Винтажная плёнка',
   '{{user_prompt}}, vintage 35mm film portrait, warm grain, faded color palette, 1970s analog feel',
   '{"aspect_ratio":"3:4"}',
   'https://files.gptweb.ru/lobe/presets/portrait-vintage-film.mp4',
   ARRAY[]::text[], 60),

  -- Landscape (3 more)
  ('landscape-aerial', 'image', 'wavespeed-ai/flux-1.1-pro-ultra', 'landscape',
   'Aerial View', 'Аэросъёмка',
   '{{user_prompt}}, aerial drone view, top-down composition, dramatic shadows, hyper-detailed terrain',
   '{"aspect_ratio":"16:9"}',
   'https://files.gptweb.ru/lobe/presets/landscape-aerial.mp4',
   ARRAY['top_choice'], 130),

  ('landscape-japanese-mountain', 'image', 'wavespeed-ai/flux-1.1-pro-ultra', 'landscape',
   'Japanese Mountain', 'Японские горы',
   '{{user_prompt}}, traditional Japanese mountain landscape, mist between peaks, ink-wash painting feel, serene composition',
   '{"aspect_ratio":"16:9"}',
   'https://files.gptweb.ru/lobe/presets/landscape-japanese-mountain.mp4',
   ARRAY['trending'], 140),

  ('landscape-cosmic-vista', 'image', 'wavespeed-ai/flux-1.1-pro-ultra', 'landscape',
   'Cosmic Vista', 'Космическая панорама',
   '{{user_prompt}}, cosmic vista with nebula sky, alien planet horizon, sci-fi atmosphere, otherworldly colors',
   '{"aspect_ratio":"16:9"}',
   'https://files.gptweb.ru/lobe/presets/landscape-cosmic-vista.mp4',
   ARRAY['new'], 150),

  -- Anime (2 more)
  ('anime-cyberpunk', 'image', 'google/nano-banana-pro/text-to-image', 'anime',
   'Cyberpunk Anime', 'Аниме киберпанк',
   '{{user_prompt}}, cyberpunk anime style, neon-lit Tokyo backdrop, akira-inspired, high contrast, glowing accents',
   '{"aspect_ratio":"16:9"}',
   'https://files.gptweb.ru/lobe/presets/anime-cyberpunk.mp4',
   ARRAY['top_choice'], 230),

  ('anime-dark-noir', 'image', 'google/nano-banana-pro/text-to-image', 'anime',
   'Dark Noir Anime', 'Тёмный нуар-аниме',
   '{{user_prompt}}, dark noir anime style, heavy shadows, monochrome with red accents, 90s OVA aesthetic',
   '{"aspect_ratio":"16:9"}',
   'https://files.gptweb.ru/lobe/presets/anime-dark-noir.mp4',
   ARRAY[]::text[], 240),

  -- Realistic (2 more)
  ('realistic-architectural', 'image', 'wavespeed-ai/flux-1.1-pro-ultra', 'realistic',
   'Architectural', 'Архитектурная съёмка',
   '{{user_prompt}}, architectural photography, perfect lines, dramatic perspective, magazine-quality composition',
   '{"aspect_ratio":"4:3"}',
   'https://files.gptweb.ru/lobe/presets/realistic-architectural.mp4',
   ARRAY[]::text[], 340),

  ('realistic-street-photo', 'image', 'wavespeed-ai/flux-1.1-pro-ultra', 'realistic',
   'Street Photo', 'Уличная съёмка',
   '{{user_prompt}}, candid street photography, Henri Cartier-Bresson decisive moment, 35mm grain, black and white option',
   '{"aspect_ratio":"3:2"}',
   'https://files.gptweb.ru/lobe/presets/realistic-street-photo.mp4',
   ARRAY['trending'], 350),

  -- Product (2 more)
  ('product-tech', 'image', 'wavespeed-ai/flux-1.1-pro-ultra', 'product',
   'Tech Product', 'Техно-продукт',
   '{{user_prompt}}, tech product photography, gradient background, rim light on edges, Apple-keynote style',
   '{"aspect_ratio":"1:1"}',
   'https://files.gptweb.ru/lobe/presets/product-tech.mp4',
   ARRAY['top_choice'], 430),

  ('product-cosmetic', 'image', 'wavespeed-ai/flux-1.1-pro-ultra', 'product',
   'Cosmetic', 'Косметика',
   '{{user_prompt}}, cosmetic product showcase, water droplets on surface, soft pastel lighting, magazine ad aesthetic',
   '{"aspect_ratio":"1:1"}',
   'https://files.gptweb.ru/lobe/presets/product-cosmetic.mp4',
   ARRAY[]::text[], 440),

  -- Artistic (NEW category, 5)
  ('art-oil-painting', 'image', 'wavespeed-ai/flux-1.1-pro-ultra', 'artistic',
   'Oil Painting', 'Масляная живопись',
   '{{user_prompt}}, classical oil painting, visible brushstrokes, museum-quality composition, dramatic chiaroscuro',
   '{}'::jsonb,
   'https://files.gptweb.ru/lobe/presets/art-oil-painting.mp4',
   ARRAY['top_choice'], 510),

  ('art-watercolor', 'image', 'wavespeed-ai/flux-1.1-pro-ultra', 'artistic',
   'Watercolor', 'Акварель',
   '{{user_prompt}}, soft watercolor painting, color bleeds, paper texture visible, light and airy mood',
   '{}'::jsonb,
   'https://files.gptweb.ru/lobe/presets/art-watercolor.mp4',
   ARRAY[]::text[], 520),

  ('art-pop-art', 'image', 'wavespeed-ai/flux-1.1-pro-ultra', 'artistic',
   'Pop Art', 'Поп-арт',
   '{{user_prompt}}, pop art style, bold flat colors, Lichtenstein dots pattern, comic book aesthetic',
   '{}'::jsonb,
   'https://files.gptweb.ru/lobe/presets/art-pop-art.mp4',
   ARRAY['trending'], 530),

  ('art-impressionism', 'image', 'wavespeed-ai/flux-1.1-pro-ultra', 'artistic',
   'Impressionism', 'Импрессионизм',
   '{{user_prompt}}, impressionist painting, loose visible brushwork, dappled light, Monet-inspired palette',
   '{}'::jsonb,
   'https://files.gptweb.ru/lobe/presets/art-impressionism.mp4',
   ARRAY[]::text[], 540),

  ('art-pixel', 'image', 'wavespeed-ai/flux-1.1-pro-ultra', 'artistic',
   'Pixel Art', 'Пиксель-арт',
   '{{user_prompt}}, retro pixel art, 16-bit aesthetic, limited color palette, SNES-era game graphics',
   '{}'::jsonb,
   'https://files.gptweb.ru/lobe/presets/art-pixel.mp4',
   ARRAY['new'], 550)
ON CONFLICT (slug) DO NOTHING;
--> statement-breakpoint
