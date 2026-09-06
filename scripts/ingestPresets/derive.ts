/**
 * Pure derivations from a source item: slug, attribution, category, title.
 *
 * Everything here is deterministic and offline — no LLM in a cron job. The
 * Russian title is produced from a keyword table; when nothing matches we
 * fall back to the source's own (English, prompt-derived) title trimmed to a
 * card-sized label rather than inventing something.
 */
import type { Modality, SourceItem } from './types';

export const SOURCE_PLATFORM = 'x';
export const LICENSE = 'source-attribution';
/**
 * `license` value marking a row the LLM classifier judged unsafe. There is no
 * dedicated column (and no migration for one), so the verdict rides on the
 * license field, which nothing else writes. Every activation path must skip
 * these rows — `active=false` alone is not durable: the i2v activation script
 * re-evaluates only the heuristic filters and once flipped such a row back on.
 * Only a human clears it.
 */
export const BLOCKED_LICENSE = 'blocked';

/** Public base for objects uploaded to the `lobe` bucket. */
export const PUBLIC_MEDIA_BASE = 'https://ask.gptweb.ru/s3/lobe';

export const slugFor = (externalId: string): string => `trend-${externalId}`;

// --- recommended model --------------------------------------------------------

/** Model each modality is pinned to; matches what the curated rows use. */
export const DEFAULT_MODEL: Record<Modality, string> = {
  image: 'google/nano-banana-pro/text-to-image',
  video: 'bytedance/seedance-2.0-fast/text-to-video',
};

/**
 * Model an image-to-video preset recommends.
 *
 * Deliberately the `/text-to-video` card, not `…/image-to-video`: the i2v
 * cards are `enabled: false` in model-bank (no picker entry, no parameter
 * schema), and the runtime swaps the endpoint by itself when `imageUrl` is
 * set (`model-runtime/providers/wavespeed/utils/pairedEndpoint.ts`). Storing
 * the i2v id would make `findEnabledModel` miss it, so the preset's model
 * switch could never fire and the model chip would warn forever. What makes
 * a preset i2v is `requires_image`, which gates the run on a reference image.
 */
export const I2V_RECOMMENDED_MODEL = 'bytedance/seedance-2.0-fast/text-to-video';

export const recommendedModelFor = (modality: Modality, requiresImage: boolean): string =>
  modality === 'video' && requiresImage ? I2V_RECOMMENDED_MODEL : DEFAULT_MODEL[modality];

// --- attribution ------------------------------------------------------------

export interface Attribution {
  authorAvatar: string | null;
  authorName: string | null;
  authorUrl: string | null;
  sourcePlatform: string;
  sourceUrl: string | null;
}

/**
 * Most catalogue ids are X tweet snowflakes, but the images endpoint also
 * serves the source's own community uploads under ids like
 * `community_34e69cb0-4906-…`. Those have no post behind them, so a
 * `/status/<id>` link would 404 — attribution is not derivable for them.
 */
export const isSourcePostId = (id: string): boolean => /^\d{10,25}$/.test(id);

/**
 * The catalogue is a feed of third-party X posts and `id` is the tweet
 * snowflake, so both links are derivable:
 *   post   → https://x.com/<username>/status/<id>
 *   author → https://x.com/<username>
 * `author.profileUrl` is present in the payload but we derive rather than
 * trust it, so a change upstream cannot point our "Источник ↗" elsewhere.
 */
export const deriveAttribution = (item: SourceItem): Attribution => {
  const username = item.author?.username?.trim();
  const safe = username && /^[\w.]{1,30}$/.test(username) ? username : null;

  return {
    authorAvatar: item.author?.avatar?.trim() || null,
    authorName: item.author?.name?.trim() || safe,
    authorUrl: safe ? `https://x.com/${safe}` : null,
    sourcePlatform: SOURCE_PLATFORM,
    sourceUrl: safe && isSourcePostId(item.id) ? `https://x.com/${safe}/status/${item.id}` : null,
  };
};

// --- category ---------------------------------------------------------------

/** Slug used when no keyword rule matches. Categories are DB-driven (Ф2). */
export const FALLBACK_CATEGORY = 'trends';

type Rule = [RegExp, string];

const VIDEO_CATEGORY_RULES: Rule[] = [
  [/\b(anime|manga|studio ghibli|cel[- ]shaded)\b/i, 'anime'],
  [/\b(3d render|claymation|stop[- ]motion|blender|octane|voxel|miniature diorama)\b/i, '3d'],
  [/\b(commercial|advertisement|ad film|product film|unboxing|brand film)\b/i, 'ad'],
  [/\b(vlog|selfie|pov|talking to (?:the )?camera|first[- ]person)\b/i, 'vlog'],
  [/\b(explosion|particle|vfx|morph|transition|transform(?:s|ing)?|glitch|shatter)\b/i, 'effects'],
  [/\b(chase|fight|parkour|racing|stunt|action sequence|combat)\b/i, 'action'],
  [/\b(drone|aerial|dolly|orbit|crane shot|tracking shot|push[- ]in|zoom)\b/i, 'camera'],
  [/\b(dragon|wizard|magic|sorcer|elf|fairy|mythical)\b/i, 'fantasy'],
  [/\b(portrait|close[- ]up of a|character (?:study|design)|face of)\b/i, 'character'],
  [/\b(serene|peaceful|calm|ambient|timelapse|time[- ]lapse|nature documentary)\b/i, 'ambient'],
  [/\b(cinematic|film noir|anamorphic|arri alexa|movie scene)\b/i, 'cinematic'],
];

const IMAGE_CATEGORY_RULES: Rule[] = [
  [/\b(anime|manga|studio ghibli|cel[- ]shaded)\b/i, 'anime'],
  [/\b(portrait|headshot|close[- ]up of (?:a|the) (?:face|woman|man|girl|boy))\b/i, 'portrait'],
  [/\b(landscape|mountain|forest|desert|valley|coastline|sunset over)\b/i, 'landscape'],
  [/\b(product (?:shot|photo|photography)|packaging|mockup|studio lighting on a)\b/i, 'product'],
  [
    /\b(photorealistic|hyperrealistic|realistic photo|shot on (?:a )?(?:canon|nikon|sony))\b/i,
    'realistic',
  ],
  [
    /\b(painting|illustration|watercolou?r|oil on canvas|sketch|art style|poster art)\b/i,
    'artistic',
  ],
];

export const deriveCategory = (prompt: string, modality: Modality): string => {
  const rules = modality === 'video' ? VIDEO_CATEGORY_RULES : IMAGE_CATEGORY_RULES;
  for (const [pattern, slug] of rules) {
    if (pattern.test(prompt)) return slug;
  }
  return FALLBACK_CATEGORY;
};

// --- title ------------------------------------------------------------------

export const MAX_TITLE_LENGTH = 40;

/** What the shot is of. */
const SUBJECT_RULES: Rule[] = [
  [/\b(unboxing|product (?:shot|film|photo)|packaging|mockup)\b/i, 'Продукт'],
  [/\b(portrait|headshot|close[- ]up of (?:a|the) (?:face|woman|man|girl|boy))\b/i, 'Портрет'],
  [/\b(landscape|mountain|forest|desert|valley|canyon|coastline|glacier)\b/i, 'Пейзаж'],
  [/\b(city|urban|street|skyline|metropolis|downtown)\b/i, 'Город'],
  [/\b(food|dish|cooking|kitchen|recipe|dessert|cake|coffee)\b/i, 'Еда'],
  [/\b(cat|dog|bird|wildlife|animal|tiger|lion|horse|fox|whale)\b/i, 'Животные'],
  [/\b(car|vehicle|motorcycle|supercar|truck|racing)\b/i, 'Транспорт'],
  [/\b(space|planet|galaxy|astronaut|nebula|orbit(?:al)?|spacecraft)\b/i, 'Космос'],
  [/\b(underwater|deep sea|coral reef|submarine)\b/i, 'Под водой'],
  [/\b(robot|mech|android|cyborg|droid)\b/i, 'Роботы'],
  [/\b(dragon|creature|monster|beast|griffin)\b/i, 'Существа'],
  [/\b(dance|dancer|dancing|ballet|choreograph)\b/i, 'Танец'],
  [/\b(athlete|sport|running|football|basketball|surfing|skate)\b/i, 'Спорт'],
  [/\b(interior|living room|architecture|building|apartment)\b/i, 'Интерьер'],
  [/\b(vlog|selfie|pov|first[- ]person)\b/i, 'Влог'],
  [/\b(miniature|tiny|diorama|micro world)\b/i, 'Миниатюра'],
  [/\b(explosion|particle|smoke|fire|glitch|shatter)\b/i, 'Эффекты'],
];

/** How the shot looks. */
const STYLE_RULES: Rule[] = [
  [/\b(anime|manga|studio ghibli)\b/i, 'аниме'],
  [/\b(claymation|stop[- ]motion|plasticine)\b/i, 'пластилин'],
  [/\b(pixel art|8[- ]bit)\b/i, 'пиксель-арт'],
  [/\b(watercolou?r)\b/i, 'акварель'],
  [/\b(oil on canvas|oil painting)\b/i, 'живопись'],
  [/\b(3d render|blender|octane|voxel)\b/i, '3D'],
  [/\b(vintage|retro|vhs|super ?8|8mm|film grain)\b/i, 'ретро'],
  [/\b(macro|extreme close[- ]up)\b/i, 'макро'],
  [/\b(slow motion|slow[- ]mo)\b/i, 'слоу-мо'],
  [/\b(timelapse|time[- ]lapse|hyperlapse)\b/i, 'таймлапс'],
  [/\b(drone|aerial)\b/i, 'аэросъёмка'],
  [/\b(cyberpunk|neon[- ]lit|neon glow)\b/i, 'киберпанк'],
  [/\b(black and white|monochrome|greyscale|grayscale)\b/i, 'ч/б'],
  [/\b(surreal|dreamlike|dreamcore)\b/i, 'сюрреализм'],
  [/\b(commercial|advertisement|ad film)\b/i, 'реклама'],
  [/\b(fashion|editorial|runway)\b/i, 'мода'],
  [/\b(horror|eerie|creepy)\b/i, 'хоррор'],
  [/\b(fantasy|mythical|enchanted)\b/i, 'фэнтези'],
  [/\b(sci[- ]?fi|futuristic|cyber)\b/i, 'sci-fi'],
  [/\b(documentary|docu[- ]style)\b/i, 'документалка'],
  [/\b(photorealistic|hyperrealistic|photoreal)\b/i, 'фотореализм'],
  [/\b(cinematic|film noir|anamorphic)\b/i, 'кино'],
];

const firstMatch = (prompt: string, rules: Rule[]): string | null => {
  for (const [pattern, label] of rules) {
    if (pattern.test(prompt)) return label;
  }
  return null;
};

/** Trim to `max` chars on a word boundary, without a trailing ellipsis. */
export const trimLabel = (value: string, max = MAX_TITLE_LENGTH): string => {
  const clean = value
    .replaceAll(/\s+/g, ' ')
    .trim()
    .replace(/[\s.,:;–—-]+$/, '');
  if (clean.length <= max) return clean;

  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  const sliced = lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut;
  return sliced.replace(/[\s.,:;–—-]+$/, '');
};

/**
 * Short Russian card label. `Субъект: стиль` when both are detectable and the
 * result still fits, otherwise whichever half we have, otherwise the source
 * title trimmed.
 */
export const deriveTitle = (item: SourceItem): string => {
  const prompt = item.prompt ?? '';
  const subject = firstMatch(prompt, SUBJECT_RULES);
  const style = firstMatch(prompt, STYLE_RULES);

  if (subject && style) {
    const combined = `${subject}: ${style}`;
    if (combined.length <= MAX_TITLE_LENGTH) return combined;
  }
  if (subject) return subject;
  if (style) return style[0].toUpperCase() + style.slice(1);

  const fallback = trimLabel(item.title ?? '');
  return fallback.length > 0 ? fallback : slugFor(item.id);
};

// --- media urls -------------------------------------------------------------

export const previewKeyFor = (externalId: string, modality: Modality): string =>
  modality === 'video'
    ? `presets/${slugFor(externalId)}.mp4`
    : `presets/${slugFor(externalId)}.webp`;

export const posterKeyFor = (externalId: string): string => `presets/${slugFor(externalId)}.webp`;

export const publicUrlFor = (key: string): string => `${PUBLIC_MEDIA_BASE}/${key}`;
