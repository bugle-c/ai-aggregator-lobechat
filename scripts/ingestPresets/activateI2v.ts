/**
 * Activate the reference-image presets the ingest parked in the queue before
 * the matching flow had its «Добавьте фото» gate: image-to-video rows (Ф5,
 * `requires-image-pending-f5`) and image-to-image rows (Ф5b,
 * `requires-image-i2i-pending`).
 *
 * Queue reasons are not stored, so "its only reason was the hold" is
 * re-derived: every queued `requires_image` row of the chosen modality is run
 * through the current `filters.ts` on its stored prompt / aspect / popularity
 * / attribution, and only rows that would `publish` today are flipped on.
 * The per-run author cap applies as in a normal run, so one author cannot
 * flood the gallery. Rows the LLM classifier flagged unsafe carry
 * `license = 'blocked'` and are never activated, whatever the heuristic
 * filters say about them.
 *
 *   npx tsx scripts/ingestPresets/activateI2v.ts                    # dry run, video
 *   npx tsx scripts/ingestPresets/activateI2v.ts --modality=image   # dry run, image
 *   npx tsx scripts/ingestPresets/activateI2v.ts --apply            # write
 *
 * Idempotent: activated rows leave the `active = FALSE` selection.
 */
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import * as dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import type { Client } from 'pg';

import { BLOCKED_LICENSE, recommendedModelFor } from './derive';
import { evaluateBatch, parseFill, relaxForFill } from './filters';
import type { Modality, SourceItem } from './types';
import { createClient } from './upsert';

/** Reason reported for rows kept back by the LLM verdict rather than a filter. */
export const BLOCKED_REASON = 'blocked-by-llm';

const ROOT = path.join(__dirname, '../..');

const loadEnv = () => {
  dotenvExpand.expand(dotenv.config({ path: path.join(ROOT, '.env') }));
  dotenvExpand.expand(dotenv.config({ override: true, path: path.join(ROOT, '.env.local') }));
};

// --- pure part ----------------------------------------------------------------

/** The columns of a queued row that the filters need. `id` is a bigint → string in pg. */
const execFileAsync = promisify(execFile);

export interface QueuedRow {
  author_name: string | null;
  author_url: string | null;
  /** Gallery category (LLM/heuristic label) — used by `--fill`. */
  category?: string;
  external_id: string;
  id: string;
  /** Poster pixel size, probed from our stored preview when the row has no aspect yet. */
  image_height?: number;
  image_width?: number;
  /** `BLOCKED_LICENSE` when the LLM classifier flagged the row unsafe. */
  license: string | null;
  modality: Modality;
  params_lock: Record<string, unknown> | null;
  popularity: number | null;
  preview_url: string;
  prompt_template: string;
  recommended_model_id: string;
  requires_image: boolean;
  slug: string;
  /** Donor's model label (0111); `null` for rows ingested before it was stored. */
  source_model?: string | null;
  title: string;
}

export interface PlanOptions {
  /** Publishable rows per author in this activation run (default 2, as in ingest). */
  authorCap?: number;
  /** Categories that may publish with the relaxed like threshold (see `relaxForFill`). */
  fill?: ReadonlySet<string>;
}

const handleFromUrl = (url: string | null): string | undefined => {
  const match = url ? /^https:\/\/x\.com\/([\w.]{1,30})$/.exec(url) : null;
  return match?.[1];
};

/**
 * Rebuild the source item the filters saw at ingest time from what we kept.
 * `aspect_ratio` is only in `params_lock` when it resolved, so a row that
 * failed the aspect rule fails it again here; `preview_url` stands in for
 * the media url (the row exists, so media succeeded).
 */
export const rowToSourceItem = (row: QueuedRow): SourceItem => {
  const aspect = row.params_lock?.aspect_ratio;
  return {
    aspectRatio: typeof aspect === 'string' ? aspect : undefined,
    author: { name: row.author_name ?? undefined, username: handleFromUrl(row.author_url) },
    id: row.external_id,
    image: row.modality === 'image' ? row.preview_url : undefined,
    imageHeight: row.image_height,
    imageWidth: row.image_width,
    prompt: row.prompt_template,
    stats: { likes: row.popularity ?? 0 },
    title: row.title,
    videoUrl: row.modality === 'video' ? row.preview_url : undefined,
  };
};

export interface ActivationPlan {
  activate: {
    /** Set when the aspect was resolved now (probed poster) and must be written to `params_lock`. */
    aspectRatio?: string;
    id: string;
    modality: Modality;
    recommendedModelId: string;
    slug: string;
  }[];
  keep: { id: string; reasons: string[]; slug: string }[];
}

/**
 * Rows that failed the aspect rule at ingest carry neither an aspect nor
 * pixel dimensions, so a later (wider) whitelist could never re-admit them.
 * Probe our own stored poster instead — local S3, a few ms each.
 */
export const probePosterSize = async (
  url: string,
): Promise<{ height: number; width: number } | null> => {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height', '-of', 'csv=p=0', url,
    ]);
    const [w, h] = stdout.trim().split(',').map(Number);
    return w > 0 && h > 0 ? { height: h, width: w } : null;
  } catch {
    return null;
  }
};

const PROBE_CONCURRENCY = 6;

export const probeMissingAspects = async (rows: QueuedRow[]): Promise<number> => {
  const todo = rows.filter(
    (r) => typeof r.params_lock?.aspect_ratio !== 'string' && !r.image_width && r.preview_url,
  );
  let next = 0;
  let probed = 0;
  const worker = async () => {
    while (next < todo.length) {
      const row = todo[next++];
      const size = await probePosterSize(row.preview_url);
      if (size) {
        row.image_width = size.width;
        row.image_height = size.height;
        probed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: PROBE_CONCURRENCY }, worker));
  return probed;
};

/**
 * Which queued rows of `modality` pass every rule today; the rest stay
 * queued with their reasons. Rows of the other modality are ignored. The
 * stored `requires_image` flag — not a re-detection — is what says the
 * prompt needs a reference (see `filters.ts`).
 */
export const planActivation = (
  rows: QueuedRow[],
  modality: Modality = 'video',
  { authorCap, fill = new Set() }: PlanOptions = {},
): ActivationPlan => {
  const plan: ActivationPlan = { activate: [], keep: [] };
  const sameModality = rows.filter((row) => row.modality === modality);

  // The LLM verdict is not one of the filters, so it is checked first and the
  // row never reaches them — it must not even count towards the author cap.
  const batch = sameModality.filter((row) => {
    if (row.license !== BLOCKED_LICENSE) return true;
    plan.keep.push({ id: row.id, reasons: [BLOCKED_REASON], slug: row.slug });
    return false;
  });

  const results = evaluateBatch(batch.map(rowToSourceItem), {
    authorCap,
    known: new Set(),
    modality,
  });

  results.forEach(({ evaluation: strict, item }, index) => {
    const row = batch[index];
    const evaluation = relaxForFill(strict, item, row.category ?? '', fill);
    if (evaluation.verdict === 'publish') {
      const storedAspect = row.params_lock?.aspect_ratio;
      plan.activate.push({
        aspectRatio:
          typeof storedAspect === 'string' ? undefined : (evaluation.aspectRatio ?? undefined),
        id: row.id,
        modality,
        // A reference-image row is repointed to the paired t2v/t2i card (old
        // rows may carry an image-to-video id); any other row keeps its own.
        recommendedModelId: row.requires_image
          ? recommendedModelFor(modality, true, row.source_model)
          : row.recommended_model_id,
        slug: row.slug,
      });
    } else {
      plan.keep.push({ id: row.id, reasons: evaluation.reasons, slug: row.slug });
    }
  });

  return plan;
};

export const formatPlan = (plan: ActivationPlan, apply: boolean): string => {
  const lines = [
    `${apply ? 'activated' : 'would activate'}: ${plan.activate.length}`,
    ...plan.activate.map((r) => `  ${r.slug} model=${r.recommendedModelId}`),
    `kept in queue: ${plan.keep.length}`,
    ...plan.keep.map((r) => `  ${r.slug} reasons=${r.reasons.join(',')}`),
  ];
  if (!apply) lines.push('DRY RUN — nothing written; pass --apply to activate');
  return lines.join('\n');
};

// --- db part ------------------------------------------------------------------

const loadQueuedRows = async (
  client: Client,
  modality: Modality,
  all: boolean,
): Promise<QueuedRow[]> => {
  const { rows } = await client.query<QueuedRow>(
    `SELECT id::text AS id, slug, modality, title, prompt_template, params_lock, popularity,
            preview_url, external_id, author_name, author_url, recommended_model_id, license,
            requires_image, source_model, category
       FROM presets
      WHERE active = FALSE AND external_id IS NOT NULL AND modality = $1
        AND ($2::boolean OR requires_image = TRUE)
      ORDER BY id`,
    [modality, all],
  );
  return rows;
};

const applyPlan = async (client: Client, plan: ActivationPlan, modality: Modality): Promise<void> => {
  if (plan.activate.length === 0) return;
  await client.query('BEGIN');
  try {
    // `license IS DISTINCT FROM` repeats the plan's check at write time, so a
    // row blocked between the SELECT and the UPDATE stays off.
    // The plan already computed the right model per row (source_model-aware).
    for (const row of plan.activate) {
      await client.query(
        `UPDATE presets
            SET active = TRUE, recommended_model_id = $1, updated_at = NOW(),
                params_lock = CASE WHEN $5::text IS NULL THEN params_lock
                                   ELSE params_lock || jsonb_build_object('aspect_ratio', $5::text) END
          WHERE id = $2::bigint AND active = FALSE AND modality = $4
            AND license IS DISTINCT FROM $3`,
        [row.recommendedModelId, row.id, BLOCKED_LICENSE, modality, row.aspectRatio ?? null],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
};

const USAGE =
  'usage: tsx scripts/ingestPresets/activateI2v.ts [--apply] [--modality=video|image] [--all] [--author-cap=N] [--fill=cat,cat]';

export interface Args {
  /** Re-evaluate every queued row of the modality, not only reference-image ones. */
  all: boolean;
  apply: boolean;
  authorCap?: number;
  fill: Set<string>;
  modality: Modality;
}

export const parseArgs = (args: string[]): Args => {
  const parsed: Args = { all: false, apply: false, fill: new Set(), modality: 'video' };
  for (const arg of args) {
    if (arg === '--apply') parsed.apply = true;
    else if (arg === '--all') parsed.all = true;
    else if (arg === '--modality=video' || arg === '--modality=image')
      parsed.modality = arg.slice('--modality='.length) as Modality;
    else if (arg.startsWith('--fill=')) parsed.fill = parseFill(arg.slice('--fill='.length));
    else if (arg.startsWith('--author-cap=')) {
      const value = Number.parseInt(arg.slice('--author-cap='.length), 10);
      if (!Number.isInteger(value) || value <= 0) throw new Error(`bad --author-cap: ${arg}`);
      parsed.authorCap = value;
    } else throw new Error(`unknown flag: ${arg}\n${USAGE}`);
  }
  return parsed;
};

const main = async () => {
  loadEnv();

  let parsed: Args;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    process.exit(2);
  }
  const { all, apply, authorCap, fill, modality } = parsed;

  const client = createClient();
  await client.connect();
  try {
    const rows = await loadQueuedRows(client, modality, all);
    const probed = await probeMissingAspects(rows);
    if (probed) console.log(`[activateI2v] probed poster size for ${probed} row(s) without an aspect`);
    console.log(
      `[activateI2v] queued ${modality} rows${all ? '' : ' needing a reference'}: ${rows.length}` +
        (authorCap ? ` (author cap ${authorCap})` : ''),
    );

    const plan = planActivation(rows, modality, { authorCap, fill });
    if (apply) await applyPlan(client, plan, modality);

    console.log(formatPlan(plan, apply));
  } finally {
    await client.end();
  }
};

// `require.main` is undefined when the module is imported by vitest.
if (require.main === module) {
  main().catch((error) => {
    console.error('[activateI2v] failed:', error);
    process.exit(1);
  });
}
