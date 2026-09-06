/**
 * One-off (Ф5): activate the image-to-video presets that the pre-Ф5 ingest
 * parked in the queue under `requires-image-pending-f5`.
 *
 * Queue reasons are not stored, so "its only reason was the Ф5 hold" is
 * re-derived: every queued `requires_image` *video* row is run through the
 * current `filters.ts` on its stored prompt / aspect / popularity /
 * attribution, and only rows that would `publish` today are flipped on. The
 * per-run author cap applies as in a normal run, so one author cannot flood
 * the gallery. Image (i2i) rows are left alone — no image-side gate exists.
 *
 *   npx tsx scripts/ingestPresets/activateI2v.ts           # dry run (default)
 *   npx tsx scripts/ingestPresets/activateI2v.ts --apply   # write
 *
 * Idempotent: activated rows leave the `active = FALSE` selection.
 */
import path from 'node:path';

import * as dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import type { Client } from 'pg';

import { recommendedModelFor } from './derive';
import { evaluateBatch } from './filters';
import type { Modality, SourceItem } from './types';
import { createClient } from './upsert';

const ROOT = path.join(__dirname, '../..');

const loadEnv = () => {
  dotenvExpand.expand(dotenv.config({ path: path.join(ROOT, '.env') }));
  dotenvExpand.expand(dotenv.config({ override: true, path: path.join(ROOT, '.env.local') }));
};

// --- pure part ----------------------------------------------------------------

/** The columns of a queued row that the filters need. `id` is a bigint → string in pg. */
export interface QueuedRow {
  author_name: string | null;
  author_url: string | null;
  external_id: string;
  id: string;
  modality: Modality;
  params_lock: Record<string, unknown> | null;
  popularity: number | null;
  preview_url: string;
  prompt_template: string;
  recommended_model_id: string;
  slug: string;
  title: string;
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
    prompt: row.prompt_template,
    stats: { likes: row.popularity ?? 0 },
    title: row.title,
    videoUrl: row.modality === 'video' ? row.preview_url : undefined,
  };
};

export interface ActivationPlan {
  activate: { id: string; modality: Modality; recommendedModelId: string; slug: string }[];
  keep: { id: string; reasons: string[]; slug: string }[];
}

/**
 * Which queued video rows pass every rule today; the rest stay queued with
 * their reasons. Image (i2i) rows are ignored on purpose: the image flow has
 * no reference-image gate, and the stored `requires_image` flag — not a
 * re-detection — is what says the prompt needs one (see `filters.ts`).
 */
export const planActivation = (rows: QueuedRow[]): ActivationPlan => {
  const plan: ActivationPlan = { activate: [], keep: [] };
  const modality = 'video';
  const batch = rows.filter((row) => row.modality === modality);
  const results = evaluateBatch(batch.map(rowToSourceItem), { known: new Set(), modality });

  results.forEach(({ evaluation }, index) => {
    const row = batch[index];
    if (evaluation.verdict === 'publish') {
      plan.activate.push({
        id: row.id,
        modality,
        recommendedModelId: recommendedModelFor(modality, true),
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

const loadQueuedI2vRows = async (client: Client): Promise<QueuedRow[]> => {
  const { rows } = await client.query<QueuedRow>(
    `SELECT id::text AS id, slug, modality, title, prompt_template, params_lock, popularity,
            preview_url, external_id, author_name, author_url, recommended_model_id
       FROM presets
      WHERE requires_image = TRUE AND active = FALSE AND external_id IS NOT NULL
        AND modality = 'video'
      ORDER BY id`,
  );
  return rows;
};

const applyPlan = async (client: Client, plan: ActivationPlan): Promise<void> => {
  if (plan.activate.length === 0) return;
  await client.query('BEGIN');
  try {
    await client.query(
      `UPDATE presets
          SET active = TRUE, recommended_model_id = $1, updated_at = NOW()
        WHERE id = ANY($2::bigint[]) AND active = FALSE AND modality = 'video'`,
      [recommendedModelFor('video', true), plan.activate.map((r) => r.id)],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
};

const main = async () => {
  loadEnv();

  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== '--apply');
  if (unknown.length > 0) {
    console.error(`unknown flag(s): ${unknown.join(' ')}`);
    console.error('usage: tsx scripts/ingestPresets/activateI2v.ts [--apply]');
    process.exit(2);
  }
  const apply = args.includes('--apply');

  const client = createClient();
  await client.connect();
  try {
    const rows = await loadQueuedI2vRows(client);
    console.log(`[activateI2v] queued i2v rows: ${rows.length}`);

    const plan = planActivation(rows);
    if (apply) await applyPlan(client, plan);

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
