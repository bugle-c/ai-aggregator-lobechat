-- Presets V3: +20 (12 video + 8 image)
--
-- Original concepts inspired by a survey of open prompt catalogs, but
-- all wording is written from scratch in the MCSLA framework
-- (Motion · Camera · Style · Lighting · Action) so each {{user_prompt}}
-- gets wrapped in a curated style tail.
--
-- Model IDs map to packages/model-bank/src/aiModels/wavespeed.ts.
-- Preview URLs use the real S3 public domain (files.gptweb.ru/lobe).

-- ============ VIDEO (+12) ============
INSERT INTO presets
  (slug, modality, model_id, category, title, description, prompt_template, params_lock, preview_url, badges, sort_order)
VALUES
  -- Action (3)
  ('street-racing-night', 'video', 'bytedance/seedance-2.0-fast/text-to-video', 'action',
   'Night Street Racing', 'Ночная уличная гонка',
   '{{user_prompt}}, night street racing scene, low-angle tracking shot of speeding car, neon reflections on wet asphalt, motion blur on tail lights, tight cuts to driver and steering wheel, cinematic',
   '{"aspect_ratio":"16:9","duration_sec":5}',
   'https://files.gptweb.ru/lobe/presets/street-racing-night.mp4',
   ARRAY['top_choice','new'], 600),

  ('wasteland-chase', 'video', 'kwaivgi/kling-v3.0-pro/text-to-video', 'action',
   'Wasteland Chase', 'Погоня по пустоши',
   '{{user_prompt}}, post-apocalyptic industrial chase, dust and smoke, handheld camera shake, scorched-orange grading, mad-max desert aesthetic, fast action cuts',
   '{"aspect_ratio":"16:9","duration_sec":5}',
   'https://files.gptweb.ru/lobe/presets/wasteland-chase.mp4',
   ARRAY['new'], 610),

  ('vampire-alley-fight', 'video', 'kwaivgi/kling-v3.0-pro/text-to-video', 'action',
   'Vampire Alley Fight', 'Бой вампиров в переулке',
   '{{user_prompt}}, rain-soaked dark alley, supernatural fight choreography, crimson eyes glowing in shadow, slow-motion blood mist, blue-and-red neon backlight',
   '{"aspect_ratio":"16:9","duration_sec":5}',
   'https://files.gptweb.ru/lobe/presets/vampire-alley-fight.mp4',
   ARRAY['new'], 620),

  -- Effects (3)
  ('dragon-flight', 'video', 'bytedance/seedance-2.0-fast/text-to-video', 'effects',
   'Dragon Flight', 'Полёт с драконом',
   '{{user_prompt}}, soaring through the sky on a giant dragon, wings flapping at frame edges, epic clouds and sun behind, low-angle hero shot, fantasy adventure tone',
   '{"aspect_ratio":"16:9","duration_sec":6}',
   'https://files.gptweb.ru/lobe/presets/dragon-flight.mp4',
   ARRAY['top_choice','new'], 700),

  ('magical-academy', 'video', 'kwaivgi/kling-v3.0-pro/text-to-video', 'effects',
   'Magical Academy', 'Магическая академия',
   '{{user_prompt}}, magical academy interior, floating books and glowing runes, golden candlelight, slow camera dolly through gothic arches, harry-potter style mystery',
   '{"aspect_ratio":"16:9","duration_sec":5}',
   'https://files.gptweb.ru/lobe/presets/magical-academy.mp4',
   ARRAY['new'], 710),

  ('outfit-morph-beat', 'video', 'kwaivgi/kling-v3.0-pro/text-to-video', 'effects',
   'Outfit Morph on Beat', 'Смена образа в такт',
   '{{user_prompt}}, outfit transformation on the beat drop, smooth wardrobe morph between looks, locked camera on subject, rhythmic glitch transitions, fashion video aesthetic',
   '{"aspect_ratio":"9:16","duration_sec":5}',
   'https://files.gptweb.ru/lobe/presets/outfit-morph-beat.mp4',
   ARRAY['trending'], 720),

  -- Character (1)
  ('emotional-closeup', 'video', 'kwaivgi/kling-v3.0-pro/text-to-video', 'character',
   'Emotional Close-Up', 'Эмоциональный крупный план',
   '{{user_prompt}}, extreme close-up of the face, slow zoom on the eyes, micro-expressions and breath, shallow depth of field, dramatic side-light, art-house cinematography',
   '{"aspect_ratio":"16:9","duration_sec":4}',
   'https://files.gptweb.ru/lobe/presets/emotional-closeup.mp4',
   ARRAY[]::text[], 260),

  -- Ambient (5)
  ('crimson-sci-fi', 'video', 'bytedance/seedance-2.0-fast/text-to-video', 'ambient',
   'Crimson Sci-Fi Vista', 'Багровая сай-фай панорама',
   '{{user_prompt}}, alien sci-fi landscape under a crimson sky, twin suns on horizon, slow aerial drift, dust motes in red haze, blade-runner atmosphere',
   '{"aspect_ratio":"21:9","duration_sec":6}',
   'https://files.gptweb.ru/lobe/presets/crimson-sci-fi.mp4',
   ARRAY['top_choice'], 350),

  ('underwater-diving', 'video', 'bytedance/seedance-2.0-fast/text-to-video', 'ambient',
   'Underwater Diving', 'Подводное погружение',
   '{{user_prompt}}, underwater diving sequence, god rays cutting through deep blue water, bubbles drifting upward, gentle current motion, marine documentary cinematography',
   '{"aspect_ratio":"16:9","duration_sec":5}',
   'https://files.gptweb.ru/lobe/presets/underwater-diving.mp4',
   ARRAY['new'], 360),

  ('birthday-celebration', 'video', 'bytedance/seedance-2.0-fast/text-to-video', 'ambient',
   'Birthday Celebration', 'День рождения',
   '{{user_prompt}}, candle-lit birthday celebration, warm orange glow on faces, slow zoom on cake as candles are blown out, soft bokeh background, family-film tone',
   '{"aspect_ratio":"16:9","duration_sec":5}',
   'https://files.gptweb.ru/lobe/presets/birthday-celebration.mp4',
   ARRAY[]::text[], 370),

  ('rural-healing', 'video', 'bytedance/seedance-2.0-fast/text-to-video', 'ambient',
   'Rural Slow Life', 'Деревенская медитация',
   '{{user_prompt}}, slow rural countryside life, soft sunlight through curtains, lingering shots of small details, pastel mood, cottagecore healing aesthetic',
   '{"aspect_ratio":"16:9","duration_sec":6}',
   'https://files.gptweb.ru/lobe/presets/rural-healing.mp4',
   ARRAY['new'], 380),

  ('luxury-supercar-ad', 'video', 'kwaivgi/kling-v3.0-pro/text-to-video', 'ambient',
   'Luxury Supercar Ad', 'Реклама суперкара',
   '{{user_prompt}}, luxury supercar commercial, hero low-angle on the body lines, slow orbit around the car, polished reflections, studio rim light, premium automotive ad',
   '{"aspect_ratio":"21:9","duration_sec":5}',
   'https://files.gptweb.ru/lobe/presets/luxury-supercar-ad.mp4',
   ARRAY['top_choice','trending'], 390)

ON CONFLICT (slug) DO NOTHING;
--> statement-breakpoint

-- ============ IMAGE (+8) ============
INSERT INTO presets
  (slug, modality, model_id, category, title, description, prompt_template, params_lock, preview_url, badges, sort_order)
VALUES
  -- Portrait (4)
  ('portrait-monochrome', 'image', 'wavespeed-ai/flux-1.1-pro-ultra', 'portrait',
   'Monochrome Studio Portrait', 'Чёрно-белый студийный портрет',
   '{{user_prompt}}, black and white studio portrait, dramatic single-source lighting, deep shadows, sharp focus on the eyes, high contrast monochrome grading',
   '{"aspect_ratio":"3:4"}',
   'https://files.gptweb.ru/lobe/presets/portrait-monochrome.mp4',
   ARRAY['new'], 60),

  ('portrait-linkedin-pro', 'image', 'google/nano-banana-pro/text-to-image', 'portrait',
   'Pro LinkedIn Headshot', 'Деловой портрет',
   '{{user_prompt}}, professional business headshot, soft natural office lighting, neutral grey backdrop, confident expression, sharp DSLR clarity, LinkedIn-ready composition',
   '{"aspect_ratio":"1:1"}',
   'https://files.gptweb.ru/lobe/presets/portrait-linkedin-pro.png',
   ARRAY['top_choice'], 70),

  ('portrait-editorial-fashion', 'image', 'wavespeed-ai/flux-1.1-pro-ultra', 'portrait',
   'Editorial Fashion', 'Журнальная мода',
   '{{user_prompt}}, editorial fashion photography, vogue-style cover composition, high-key magazine lighting, designer wardrobe, confident model pose, glossy print finish',
   '{"aspect_ratio":"3:4"}',
   'https://files.gptweb.ru/lobe/presets/portrait-editorial-fashion.mp4',
   ARRAY['trending'], 80),

  ('portrait-hyperreal-selfie', 'image', 'wavespeed-ai/flux-1.1-pro-ultra', 'portrait',
   'Hyper-Realistic Selfie', 'Сверх-реалистичное селфи',
   '{{user_prompt}}, hyper-realistic phone selfie, visible skin pores and small imperfections, natural daylight from window, casual framing, raw smartphone camera look',
   '{"aspect_ratio":"3:4"}',
   'https://files.gptweb.ru/lobe/presets/portrait-hyperreal-selfie.png',
   ARRAY['new','trending'], 90),

  -- Realistic (1)
  ('realistic-old-photo-restore', 'image', 'google/nano-banana-pro/text-to-image', 'realistic',
   'Old Photo Restored', 'Реставрация старого фото',
   '{{user_prompt}}, restored vintage photograph reimagined as modern DSLR portrait, sharp detail, true skin tones, preserved period clothing and setting, archival quality',
   '{"aspect_ratio":"4:5"}',
   'https://files.gptweb.ru/lobe/presets/realistic-old-photo-restore.png',
   ARRAY['top_choice'], 290),

  -- Artistic (2)
  ('art-fantasy-mage', 'image', 'wavespeed-ai/flux-1.1-pro-ultra', 'artistic',
   'Fantasy Mage Portrait', 'Портрет мага-фэнтези',
   '{{user_prompt}}, fantasy mage portrait, lavender and violet palette, glowing arcane sigils, flowing robes, painterly digital art, dnd-style character illustration',
   '{"aspect_ratio":"3:4"}',
   'https://files.gptweb.ru/lobe/presets/art-fantasy-mage.png',
   ARRAY['new'], 560),

  ('art-city-food-map', 'image', 'wavespeed-ai/flux-1.1-pro-ultra', 'artistic',
   'City Food Map', 'Карта кафе и ресторанов',
   '{{user_prompt}}, hand-drawn illustrated city food map, watercolor markers for cafes and restaurants, charming whimsical typography, top-down isometric view, travel-guide aesthetic',
   '{"aspect_ratio":"4:3"}',
   'https://files.gptweb.ru/lobe/presets/art-city-food-map.png',
   ARRAY['new'], 570),

  -- Product (1)
  ('product-exploded-view', 'image', 'google/nano-banana-pro/text-to-image', 'product',
   'Exploded View Poster', 'Развёрнутая схема продукта',
   '{{user_prompt}}, exploded-view product poster, components floating apart with thin connector lines, dark blueprint background, sharp engineering detail, premium tech-ad styling',
   '{"aspect_ratio":"4:5"}',
   'https://files.gptweb.ru/lobe/presets/product-exploded-view.png',
   ARRAY['top_choice'], 620)

ON CONFLICT (slug) DO NOTHING;
--> statement-breakpoint
