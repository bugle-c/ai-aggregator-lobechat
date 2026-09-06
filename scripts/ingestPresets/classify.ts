/**
 * LLM labelling for ingested presets.
 *
 * The keyword heuristics in `derive.ts` / `filters.ts` produce misleading
 * labels often enough to hurt («Портрет: макро» for a burger commercial, a
 * reference-image prompt slipping the i2v regex because it says "uploaded
 * photo" instead of "uploaded image"). One small-model call per item gives a
 * concrete Russian title, a category from the existing slug list, a stricter
 * requires-image verdict and a safety flag.
 *
 * Cost/abuse guards (an unguarded LLM timer once burned money overnight):
 *   - the caller never constructs a classifier unless there is work to do;
 *   - a hard cap of `MAX_CLASSIFICATIONS_PER_RUN` calls per process;
 *   - at most ONE retry per item, 20 s timeout per attempt;
 *   - token usage and USD are accumulated and printed in the run summary.
 *
 * Any failure (transport, non-2xx, bad JSON, schema mismatch, cap reached)
 * is reported as `{ ok: false }` and the caller falls back to the heuristic
 * labels — the ingest never fails because of the LLM.
 */
import { z } from 'zod';

import { CATEGORY_LABELS } from '../../src/features/Generators/PRESET_CATEGORIES';
import { FALLBACK_CATEGORY, MAX_TITLE_LENGTH, trimLabel } from './derive';
import type { Modality } from './types';

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const CLASSIFIER_MODEL = 'openai/gpt-5-mini';

/** Hard per-process cap. Beyond it every call returns `{ ok: false, reason: 'cap' }`. */
export const MAX_CLASSIFICATIONS_PER_RUN = 60;
export const REQUEST_TIMEOUT_MS = 20_000;
export const MAX_ATTEMPTS = 2; // one call + one retry, never more
export const PROMPT_CHAR_LIMIT = 1500;
export const MAX_SUMMARY_LENGTH = 90;

/**
 * gpt-5-mini is a reasoning model: with the default effort ~200 reasoning
 * tokens are spent before a single content token, so a 200-token budget
 * returns an empty message (measured: 192 reasoning tokens, `finish=length`).
 * `effort: minimal` brings that to 0 and the JSON itself is ~80 tokens.
 */
const MAX_TOKENS = 300;

/** OpenRouter list price for gpt-5-mini, USD per token — used when `usage.cost` is absent. */
export const PRICE_PER_TOKEN = { input: 0.25 / 1e6, output: 2 / 1e6 };

// --- categories -------------------------------------------------------------

/**
 * Image slugs are the tail of `CATEGORY_ORDER`; everything else in the label
 * map is a video slug. Listed explicitly (and checked against the label map
 * at load time) so a renamed slug fails loudly instead of silently routing
 * every item to the heuristic category.
 */
const IMAGE_CATEGORIES = ['portrait', 'realistic', 'artistic', 'landscape', 'product'] as const;

const VIDEO_CATEGORIES = Object.keys(CATEGORY_LABELS).filter(
  (slug) => slug !== FALLBACK_CATEGORY && !(IMAGE_CATEGORIES as readonly string[]).includes(slug),
);

for (const slug of IMAGE_CATEGORIES) {
  if (!(slug in CATEGORY_LABELS)) throw new Error(`classify: unknown image category ${slug}`);
}

/** Short English glosses so the model picks the slug by meaning, not by name. */
const CATEGORY_GLOSS: Record<string, string> = {
  '3d': '3D renders, CGI, claymation, stop-motion, voxel',
  'action': 'chases, fights, stunts, sports action, racing',
  'ad': 'commercials, product films, unboxing, brand promos',
  'ambient': 'calm mood pieces, nature, timelapses, no plot',
  'anime': 'anime / manga / cel-shaded look',
  'artistic': 'paintings, illustrations, posters, stylised art',
  'camera': 'the point is a camera move: drone, orbit, dolly, FPV',
  'character': 'a person or character is the subject: portraits, talking heads, character studies',
  'cinematic': 'film-like live-action scenes and trailers',
  'effects': 'VFX, morphs, transitions, explosions, glitch, transformations',
  'fantasy': 'dragons, magic, mythical worlds, sci-fi creatures',
  'landscape': 'landscapes, nature, cityscapes without a person as subject',
  'portrait': 'portraits and headshots of a person',
  'product': 'product shots, packaging, mockups, food photography',
  'realistic': 'photorealistic photography of anything else',
  'trends': 'nothing above fits',
  'vlog': 'vlog / selfie / POV / talking to camera / UGC',
};

export const allowedCategories = (modality: Modality): readonly string[] =>
  modality === 'video'
    ? [...VIDEO_CATEGORIES, FALLBACK_CATEGORY]
    : [...IMAGE_CATEGORIES, FALLBACK_CATEGORY];

// --- schema -----------------------------------------------------------------

/**
 * Wire format. Strings are bounded generously and then trimmed on a word
 * boundary to the card limits — a 45-char title is a trim, not a failure.
 * Anything beyond twice the limit is a runaway answer and does fail.
 */
export const ClassificationSchema = z.object({
  category: z.string().trim().min(1).max(40),
  requires_image: z.boolean(),
  summary_ru: z
    .string()
    .trim()
    .min(1)
    .max(MAX_SUMMARY_LENGTH * 2)
    .transform((value) => trimLabel(value, MAX_SUMMARY_LENGTH)),
  title_ru: z
    .string()
    .trim()
    .min(1)
    .max(MAX_TITLE_LENGTH * 2)
    .transform((value) => trimLabel(value.replaceAll(/^[«"']+|[»"'.]+$/g, ''), MAX_TITLE_LENGTH)),
  unsafe: z.boolean(),
});

export type Classification = z.infer<typeof ClassificationSchema>;

export interface ClassifyInput {
  aspectRatio?: string;
  modality: Modality;
  prompt: string;
}

export interface ClassifyOk {
  /** Validated slug, or `null` when the model answered with a slug we do not have. */
  category: string | null;
  ok: true;
  /** What the model actually said for `category` (for the run log). */
  rawCategory: string;
  requiresImage: boolean;
  summary: string;
  title: string;
  unsafe: boolean;
}

export interface ClassifyFail {
  ok: false;
  reason: string;
}

export type ClassifyResult = ClassifyFail | ClassifyOk;

export interface ClassifierStats {
  calls: number;
  /** Items the classifier refused because the per-run cap was reached. */
  capped: number;
  completionTokens: number;
  failed: number;
  promptTokens: number;
  retries: number;
  usd: number;
}

export const emptyStats = (): ClassifierStats => ({
  calls: 0,
  capped: 0,
  completionTokens: 0,
  failed: 0,
  promptTokens: 0,
  retries: 0,
  usd: 0,
});

export const formatStats = (stats: ClassifierStats): string =>
  `llm: calls=${stats.calls} retries=${stats.retries} failed=${stats.failed} capped=${stats.capped} ` +
  `tokens=${stats.promptTokens}in/${stats.completionTokens}out usd=$${stats.usd.toFixed(4)}` +
  (stats.calls > 0 ? ` (~$${(stats.usd / stats.calls).toFixed(5)}/item)` : '');

// --- prompt -----------------------------------------------------------------

export const buildSystemPrompt = (modality: Modality): string => {
  const slugs = allowedCategories(modality)
    .map((slug) => `  - "${slug}": ${CATEGORY_GLOSS[slug] ?? CATEGORY_LABELS[slug] ?? slug}`)
    .join('\n');
  const kind = modality === 'video' ? 'video' : 'image';

  return [
    `You label presets for an AI ${kind} generator used by Russian-speaking beginners.`,
    `You receive the generation prompt of one preset. Answer with ONE JSON object and nothing else:`,
    '',
    '{',
    `  "title_ru": string,       // Russian, at most ${MAX_TITLE_LENGTH} characters. A concrete noun phrase saying WHAT the ${kind} shows`,
    '                            // (subject first, then genre/style if it matters), e.g. "Реклама бургера в стиле кино",',
    '                            // "Кошка на белом фоне", "Курьер в неоновом мегаполисе". Never a bare style word',
    '                            // ("Кино", "Аниме", "Макро"), never a translation of the whole prompt, no quotes, no final period.',
    `  "summary_ru": string,     // Russian, at most ${MAX_SUMMARY_LENGTH} characters, one plain sentence: what the user will get.`,
    '  "category": string,       // exactly one slug from the list below; "trends" only when nothing fits.',
    '  "requires_image": boolean,// true when the result depends on an image the USER must supply: an uploaded/attached',
    '                            // photo or picture, a reference image/still/frame/face, a character sheet, @image1-style',
    '                            // placeholders, "this photo", "the person in the picture", "each uploaded photo" — in any',
    `                            // language or wording. false for pure text-to-${kind}.`,
    '  "unsafe": boolean         // true for nudity or sexual content, graphic violence or gore, real politicians or',
    '                            // celebrities named or clearly implied, hate or extremist content, drug use.',
    '}',
    '',
    'Category slugs:',
    slugs,
  ].join('\n');
};

export const truncatePrompt = (prompt: string, limit = PROMPT_CHAR_LIMIT): string => {
  const clean = prompt.replaceAll(/\s+/g, ' ').trim();
  return clean.length <= limit ? clean : `${clean.slice(0, limit)} […]`;
};

export const buildUserPrompt = (input: ClassifyInput): string =>
  [
    `Modality: ${input.modality}`,
    `Aspect ratio: ${input.aspectRatio ?? 'unknown'}`,
    'Prompt:',
    '"""',
    truncatePrompt(input.prompt),
    '"""',
  ].join('\n');

// --- classifier -------------------------------------------------------------

type FetchLike = typeof fetch;

export interface ClassifierOptions {
  apiKey: string;
  fetchImpl?: FetchLike;
  /** Overridable for tests; production uses the module constant. */
  maxCalls?: number;
  model?: string;
  /** Overridable for tests so a retry does not sleep. */
  retryDelayMs?: number;
  timeoutMs?: number;
}

interface OpenRouterResponse {
  choices?: { finish_reason?: string; message?: { content?: string | null } }[];
  error?: { message?: string };
  usage?: {
    completion_tokens?: number;
    cost?: number;
    prompt_tokens?: number;
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class Classifier {
  readonly stats = emptyStats();

  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly maxCalls: number;
  private readonly model: string;
  private readonly retryDelayMs: number;
  private readonly timeoutMs: number;
  private capLogged = false;

  constructor(options: ClassifierOptions) {
    if (!options.apiKey) throw new Error('OPENROUTER_API_KEY is not set (use --no-llm to skip labelling)');
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxCalls = options.maxCalls ?? MAX_CLASSIFICATIONS_PER_RUN;
    this.model = options.model ?? CLASSIFIER_MODEL;
    this.retryDelayMs = options.retryDelayMs ?? 1000;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  /** Construct from the process environment (after `loadEnv()`). */
  static fromEnv(overrides: Partial<ClassifierOptions> = {}): Classifier {
    return new Classifier({ apiKey: process.env.OPENROUTER_API_KEY ?? '', ...overrides });
  }

  get callsLeft(): number {
    return Math.max(0, this.maxCalls - this.stats.calls);
  }

  async classify(input: ClassifyInput): Promise<ClassifyResult> {
    if (this.stats.calls >= this.maxCalls) {
      this.stats.capped += 1;
      if (!this.capLogged) {
        this.capLogged = true;
        console.warn(
          `[classify] per-run cap of ${this.maxCalls} calls reached — remaining items keep heuristic labels`,
        );
      }
      return { ok: false, reason: 'cap' };
    }

    let lastReason = 'unknown';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      if (attempt > 1) {
        this.stats.retries += 1;
        await sleep(this.retryDelayMs);
      }
      this.stats.calls += 1;

      const outcome = await this.attempt(input);
      if (outcome.ok) return outcome;

      lastReason = outcome.reason;
      if (!outcome.retryable) break;
    }

    this.stats.failed += 1;
    return { ok: false, reason: lastReason };
  }

  private async attempt(
    input: ClassifyInput,
  ): Promise<ClassifyOk | { ok: false; reason: string; retryable: boolean }> {
    let response: Response;
    try {
      response = await this.fetchImpl(OPENROUTER_URL, {
        body: JSON.stringify({
          max_tokens: MAX_TOKENS,
          messages: [
            { content: buildSystemPrompt(input.modality), role: 'system' },
            { content: buildUserPrompt(input), role: 'user' },
          ],
          model: this.model,
          reasoning: { effort: 'minimal' },
          response_format: { type: 'json_object' },
          temperature: 0,
          usage: { include: true },
        }),
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://gptweb.ru',
          'X-Title': 'gptweb preset ingest',
        },
        method: 'POST',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      return { ok: false, reason: `transport: ${String(error)}`, retryable: true };
    }

    let payload: OpenRouterResponse;
    try {
      payload = (await response.json()) as OpenRouterResponse;
    } catch {
      return { ok: false, reason: `http ${response.status}: non-JSON body`, retryable: true };
    }

    this.recordUsage(payload.usage);

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      return {
        ok: false,
        reason: `http ${response.status}: ${payload.error?.message ?? 'no message'}`,
        retryable,
      };
    }

    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      return {
        ok: false,
        reason: `empty content (finish=${payload.choices?.[0]?.finish_reason ?? '?'})`,
        retryable: true,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { ok: false, reason: 'content is not JSON', retryable: true };
    }

    const result = ClassificationSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      return { ok: false, reason: `schema: ${issues}`, retryable: true };
    }

    const value = result.data;
    const category = allowedCategories(input.modality).includes(value.category)
      ? value.category
      : null;

    return {
      category,
      ok: true,
      rawCategory: value.category,
      requiresImage: value.requires_image,
      summary: value.summary_ru,
      title: value.title_ru,
      unsafe: value.unsafe,
    };
  }

  private recordUsage(usage: OpenRouterResponse['usage']) {
    if (!usage) return;
    const promptTokens = usage.prompt_tokens ?? 0;
    const completionTokens = usage.completion_tokens ?? 0;
    this.stats.promptTokens += promptTokens;
    this.stats.completionTokens += completionTokens;
    this.stats.usd +=
      typeof usage.cost === 'number'
        ? usage.cost
        : promptTokens * PRICE_PER_TOKEN.input + completionTokens * PRICE_PER_TOKEN.output;
  }
}
