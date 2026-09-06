/**
 * Auto-publish rules for the preset ingest job (spec Ф4).
 *
 * All logic here is pure and synchronous so it can be unit-tested without
 * touching the network, ffmpeg or the DB. The only rule that lives elsewhere
 * is "media downloaded and converted successfully" — an item that fails it is
 * counted as `failed-media` and not stored at all, because `preview_url` is
 * NOT NULL and a row without a preview is useless.
 *
 * Verdicts:
 *   skip    — safety stop-list or duplicate: never stored.
 *   queue   — a quality rule failed: stored with `active=false` for a human.
 *   publish — everything passed: stored with `active=true`.
 */
import { isSourcePostId } from './derive';
import type { Evaluation, Modality, SourceItem, Verdict } from './types';

// --- thresholds -------------------------------------------------------------

export const MIN_PROMPT_LENGTH = 80;
export const MIN_LIKES = 50;
export const MIN_ASCII_RATIO = 0.9;
export const ASCII_SAMPLE_LENGTH = 200;
export const MAX_PER_AUTHOR_PER_RUN = 2;

/**
 * Ratios the generation models accept. `params_lock.aspect_ratio` is passed
 * straight to the model, so an item is snapped to the nearest entry here.
 */
export const ASPECT_WHITELIST = ['16:9', '9:16', '1:1', '4:3', '3:4'] as const;

/**
 * The source does NOT normalise `aspectRatio` — real values include
 * `427:240`, `26:15`, `159:91` and `7:4`, all of which are 16:9 footage within
 * a couple of percent. Matching the whitelist literally would drop ~25% of a
 * page of otherwise-perfect 16:9 clips, so we snap to the nearest supported
 * ratio and reject only when nothing is within tolerance (e.g. a 2:3 image).
 */
export const ASPECT_TOLERANCE = 0.03;

// --- safety stop-list -------------------------------------------------------

/**
 * Terms that make an item unpublishable regardless of anything else: adult
 * content, graphic violence, weapons, drugs, identifiable political figures,
 * and trademarked brands / characters (the legal risk in re-hosting a
 * third-party clip is mostly here).
 *
 * Matched case-insensitively on word boundaries, so `gun` does not fire on
 * "begun" and `meth` does not fire on "method".
 */
export const SAFETY_STOPLIST: readonly string[] = [
  // nsfw
  'nsfw',
  'nude',
  'nudity',
  'naked',
  'porn',
  'pornographic',
  'erotic',
  'topless',
  'lingerie',
  'fetish',
  'bdsm',
  'seductive',
  'cleavage',
  'sexual',
  'orgasm',
  'strip club',
  // violence
  'gore',
  'gory',
  'blood',
  'bloody',
  'beheading',
  'decapitation',
  'decapitated',
  'mutilated',
  'mutilation',
  'torture',
  'massacre',
  'murder',
  'corpse',
  'dismembered',
  'execution',
  'stabbing',
  'self-harm',
  'suicide',
  // weapons
  'gun',
  'guns',
  'gunfire',
  'handgun',
  'shotgun',
  'rifle',
  'pistol',
  'revolver',
  'firearm',
  'firearms',
  'sniper',
  'ak-47',
  'grenade',
  'bomb',
  'bombing',
  'missile',
  'ammunition',
  // drugs
  'cocaine',
  'heroin',
  'meth',
  'methamphetamine',
  'cannabis',
  'marijuana',
  'narcotics',
  'opioid',
  'fentanyl',
  'drug dealer',
  // political figures
  'trump',
  'biden',
  'obama',
  'putin',
  'zelensky',
  'xi jinping',
  'kim jong',
  'netanyahu',
  'erdogan',
  'macron',
  'elon musk',
  // brands & trademarked characters
  'nike',
  'adidas',
  'coca-cola',
  'coca cola',
  'pepsi',
  'mcdonald',
  "mcdonald's",
  'starbucks',
  'disney',
  'pixar',
  'marvel',
  'pokemon',
  'pokémon',
  'nintendo',
  'playstation',
  'ferrari',
  'lamborghini',
  'rolex',
  'gucci',
  'prada',
  'louis vuitton',
  'chanel',
  'netflix',
  'batman',
  'superman',
  'spider-man',
  'spiderman',
  'mickey mouse',
  'star wars',
  'harry potter',
];

const escapeRegExp = (value: string) => value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

/**
 * `\b` is useless next to a non-word character (`ak-47`, `mcdonald's`), so we
 * only anchor the sides that actually start/end with a word character.
 */
const buildStoplistPattern = (terms: readonly string[]): RegExp => {
  const parts = terms.map((term) => {
    const escaped = escapeRegExp(term);
    const left = /^\w/.test(term) ? String.raw`\b` : '';
    const right = /\w$/.test(term) ? String.raw`\b` : '';
    return `${left}${escaped}${right}`;
  });
  return new RegExp(`(${parts.join('|')})`, 'i');
};

const STOPLIST_PATTERN = buildStoplistPattern(SAFETY_STOPLIST);

/** Returns the offending term, or `null` when the text is clean. */
export const findUnsafeTerm = (text: string): string | null => {
  const match = STOPLIST_PATTERN.exec(text ?? '');
  return match ? match[1].toLowerCase() : null;
};

// --- i2v detection ----------------------------------------------------------

/**
 * The payload's `referenceInputContract` / `contentType` / `promptReady` are
 * constants (`legacy` / `gallery_video` / `true`) and useless as i2v
 * discriminators — the only signal is the prompt text itself.
 *
 * A hit on a video prompt is not a quality failure (since Ф5): the row is
 * stored with `requires_image=true`, the UI shows the «Нужно фото» badge and
 * refuses to run until a reference image is attached, and the runtime routes
 * the paired `/text-to-video` model to its `/image-to-video` endpoint by
 * itself. Rows queued under the pre-Ф5 hold are flipped on by
 * `activateI2v.ts`. Image (i2i) hits stay queued — see `evaluateItem`.
 */
const I2V_PATTERNS: readonly RegExp[] = [
  /@\[?image\s?\d\]?/i,
  // "each uploaded photo" — seen live on an image row that `the uploaded` missed
  /\buploaded (?:image|photo|picture)s?\b/i,
  /\bthe uploaded\b/i,
  /\buse the uploaded\b/i,
  /\battach(?:ed)? your image\b/i,
  /\battach your (?:photo|picture)\b/i,
  /\breference face\b/i,
  /\breference image\b/i,
  /\breference photo\b/i,
  /\bthis image\b/i,
];

export const detectRequiresImage = (prompt: string): boolean =>
  I2V_PATTERNS.some((pattern) => pattern.test(prompt ?? ''));

// --- ascii ratio ------------------------------------------------------------

/** Share of ASCII code points in the first `ASCII_SAMPLE_LENGTH` characters. */
export const asciiRatio = (prompt: string, sampleLength = ASCII_SAMPLE_LENGTH): number => {
  const sample = [...(prompt ?? '')].slice(0, sampleLength);
  if (sample.length === 0) return 0;
  const ascii = sample.filter((ch) => ch.codePointAt(0)! < 128).length;
  return ascii / sample.length;
};

// --- aspect ratio -----------------------------------------------------------

const ratioValue = (label: string): number => {
  const [w, h] = label.split(':').map(Number);
  return w / h;
};

/**
 * Resolve an item to a whitelisted ratio.
 *
 * Prefers the declared `aspectRatio` string (videos), falls back to
 * `imageWidth`/`imageHeight` (the images endpoint ships no `aspectRatio` at
 * all). Returns `null` when nothing is within `ASPECT_TOLERANCE`.
 */
export const resolveAspectRatio = (item: SourceItem): string | null => {
  let value: number | null = null;

  if (typeof item.aspectRatio === 'string' && item.aspectRatio.includes(':')) {
    const parsed = ratioValue(item.aspectRatio);
    if (Number.isFinite(parsed) && parsed > 0) value = parsed;
  }

  if (value === null && item.imageWidth && item.imageHeight) {
    value = item.imageWidth / item.imageHeight;
  }

  if (value === null || !Number.isFinite(value) || value <= 0) return null;

  let best: string | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const label of ASPECT_WHITELIST) {
    const delta = Math.abs(ratioValue(label) - value) / value;
    if (delta < bestDelta) {
      bestDelta = delta;
      best = label;
    }
  }

  return bestDelta <= ASPECT_TOLERANCE ? best : null;
};

// --- evaluation -------------------------------------------------------------

export interface EvaluateContext {
  /** Mutated as items are evaluated: username → publishable items so far. */
  authorPublishCount: Map<string, number>;
  known: Set<string>;
  modality: Modality;
}

const authorKey = (item: SourceItem): string =>
  (item.author?.username || item.author?.name || 'unknown').toLowerCase();

/**
 * Evaluate one item. Mutates `ctx.authorPublishCount` and `ctx.known` so a
 * batch is evaluated by simply mapping over it in catalogue order.
 */
export const evaluateItem = (item: SourceItem, ctx: EvaluateContext): Evaluation => {
  const prompt = item.prompt ?? '';
  const reasons: string[] = [];
  const requiresImage = detectRequiresImage(prompt);

  // --- hard skips: nothing is stored --------------------------------------
  if (ctx.known.has(item.id)) {
    return { reasons: ['duplicate'], requiresImage, verdict: 'skip' };
  }

  const unsafe = findUnsafeTerm(`${prompt}\n${item.title ?? ''}`);
  if (unsafe) {
    return { reasons: [`safety:${unsafe}`], requiresImage, verdict: 'skip' };
  }

  ctx.known.add(item.id);

  // --- quality rules: failures land in the queue ---------------------------
  if (prompt.length < MIN_PROMPT_LENGTH) reasons.push('prompt-too-short');
  if (asciiRatio(prompt) < MIN_ASCII_RATIO) reasons.push('non-latin-prompt');

  const aspectRatio = resolveAspectRatio(item) ?? undefined;
  if (!aspectRatio) reasons.push('aspect-ratio');

  const likes = item.stats?.likes ?? 0;
  if (likes < MIN_LIKES) reasons.push('low-likes');

  // Attribution is mandatory (spec, "Правовой" risk): without a linkable
  // source post the preset cannot be auto-published.
  if (!item.author?.username || !isSourcePostId(item.id)) reasons.push('no-attribution');

  const mediaUrl = ctx.modality === 'video' ? item.videoUrl : (item.images?.[0] ?? item.image);
  if (!mediaUrl) reasons.push('no-media-url');

  /**
   * Ф5 wired the reference-image gate for video only. The image flow has no
   * «Добавьте фото» gate yet, so an image prompt that says "@image1" would
   * run with nothing attached — keep those queued until i2i gating exists.
   */
  if (requiresImage && ctx.modality === 'image') reasons.push('requires-image-i2i-pending');

  const authorCount = ctx.authorPublishCount.get(authorKey(item)) ?? 0;
  if (authorCount >= MAX_PER_AUTHOR_PER_RUN) reasons.push('author-cap');

  const verdict: Verdict = reasons.length === 0 ? 'publish' : 'queue';
  if (verdict === 'publish') ctx.authorPublishCount.set(authorKey(item), authorCount + 1);

  return { aspectRatio, reasons, requiresImage, verdict };
};

/** Evaluate a batch in catalogue order, sharing the per-run author budget. */
export const evaluateBatch = (
  items: SourceItem[],
  { known, modality }: { known: Set<string>; modality: Modality },
): { evaluation: Evaluation; item: SourceItem }[] => {
  const ctx: EvaluateContext = {
    authorPublishCount: new Map(),
    known: new Set(known),
    modality,
  };
  return items.map((item) => ({ evaluation: evaluateItem(item, ctx), item }));
};
