/**
 * One-off: back-fill `source_model` and re-derive `recommended_model_id` for
 * rows ingested before the donor's `model` label was stored (0111).
 *
 *  - images: the donor has a per-id endpoint (`/api/images/<id>` → `data.model`,
 *    slug-style labels such as «nanobanana», «gpt-image», «midjourney»);
 *  - videos: no per-id endpoint — the feed is walked (`/api/videos?offset=N`)
 *    until every stored video id has been seen or `--max-pages` is reached.
 *
 * Dry run by default; `--apply` writes. Rows whose derived model is unchanged
 * still get `source_model` filled. Hand-curated rows (no `external_id`) are
 * never touched.
 *
 *   npx tsx scripts/ingestPresets/relabelModels.ts [--modality=video|image|both] [--max-pages=60] [--apply]
 */
import path from 'node:path';

import * as dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import type { Client } from 'pg';

import { recommendedModelFor } from './derive';
import { extractJson, fetchCatalogPage } from './fetchCatalog';
import type { Modality } from './types';
import { createClient } from './upsert';

const ROOT = path.join(__dirname, '../..');
const READER = 'https://r.jina.ai/';
const DONOR = 'https://www.meigen.ai';
const PER_ID_CONCURRENCY = 4;

const loadEnv = () => {
  dotenvExpand.expand(dotenv.config({ path: path.join(ROOT, '.env') }));
  dotenvExpand.expand(dotenv.config({ override: true, path: path.join(ROOT, '.env.local') }));
};

interface StoredRow {
  external_id: string;
  id: string;
  modality: Modality;
  recommended_model_id: string;
  requires_image: boolean;
  source_model: string | null;
}

export interface Change {
  from: string;
  id: string;
  sourceModel: string;
  to: string;
}

/** Pure: which rows change given the donor labels we managed to fetch. */
export const planChanges = (rows: StoredRow[], labels: Map<string, string>): Change[] => {
  const out: Change[] = [];
  for (const row of rows) {
    const sourceModel = labels.get(row.external_id);
    if (!sourceModel) continue;
    const to = recommendedModelFor(row.modality, row.requires_image, sourceModel);
    if (to === row.recommended_model_id && row.source_model === sourceModel) continue;
    out.push({ from: row.recommended_model_id, id: row.id, sourceModel, to });
  }
  return out;
};

export const summarize = (changes: Change[], rows: StoredRow[]): string => {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const counts = new Map<string, number>();
  for (const c of changes) {
    const key = `${byId.get(c.id)?.modality} ${c.from} → ${c.to}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `  ${String(n).padStart(4)}  ${k}`)
    .join('\n');
};

const fetchImageLabel = async (externalId: string): Promise<string | null> => {
  const res = await fetch(`${READER}${DONOR}/api/images/${externalId}`, {
    headers: { 'x-no-cache': 'true', 'x-respond-with': 'text' },
    signal: AbortSignal.timeout(40_000),
  });
  if (!res.ok) return null;
  const body = extractJson(await res.text()) as { data?: { model?: unknown } } | null;
  const model = body?.data?.model;
  return typeof model === 'string' && model ? model : null;
};

const collectImageLabels = async (ids: string[]): Promise<Map<string, string>> => {
  const labels = new Map<string, string>();
  let next = 0;
  let failed = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      try {
        const label = await fetchImageLabel(id);
        if (label) labels.set(id, label);
        else failed += 1;
      } catch {
        failed += 1;
      }
      if ((labels.size + failed) % 50 === 0)
        console.log(`[relabelModels] images: ${labels.size} labelled, ${failed} without label`);
    }
  };
  await Promise.all(Array.from({ length: PER_ID_CONCURRENCY }, worker));
  console.log(`[relabelModels] images done: ${labels.size} labelled, ${failed} without label`);
  return labels;
};

const collectVideoLabels = async (ids: Set<string>, maxPages: number): Promise<Map<string, string>> => {
  const labels = new Map<string, string>();
  const pending = new Set(ids);
  for (let page = 0; page < maxPages && pending.size > 0; page += 1) {
    const result = await fetchCatalogPage('video', page * 20);
    for (const item of result.items) {
      if (pending.has(item.id) && typeof item.model === 'string' && item.model) {
        labels.set(item.id, item.model);
        pending.delete(item.id);
      }
    }
    if (!result.hasMore || result.items.length === 0) break;
  }
  console.log(`[relabelModels] videos: ${labels.size} labelled, ${pending.size} not seen in the feed`);
  return labels;
};

const loadRows = async (client: Client, modalities: Modality[]): Promise<StoredRow[]> => {
  const { rows } = await client.query<StoredRow>(
    `SELECT id::text AS id, external_id, modality, requires_image, source_model, recommended_model_id
       FROM presets
      WHERE external_id IS NOT NULL AND modality = ANY($1::text[])
      ORDER BY id`,
    [modalities],
  );
  return rows;
};

const applyChanges = async (client: Client, changes: Change[]): Promise<void> => {
  await client.query('BEGIN');
  try {
    for (const c of changes) {
      await client.query(
        `UPDATE presets SET source_model = $1, recommended_model_id = $2, updated_at = NOW()
          WHERE id = $3::bigint AND external_id IS NOT NULL`,
        [c.sourceModel, c.to, c.id],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
};

const main = async () => {
  loadEnv();
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const modalityArg = args.find((a) => a.startsWith('--modality='))?.slice('--modality='.length);
  const modalities: Modality[] =
    modalityArg === 'video' || modalityArg === 'image' ? [modalityArg] : ['video', 'image'];
  const maxPages = Number(args.find((a) => a.startsWith('--max-pages='))?.slice('--max-pages='.length) ?? 60);

  const client = createClient();
  await client.connect();
  try {
    const rows = await loadRows(client, modalities);
    console.log(`[relabelModels] imported rows: ${rows.length}`);

    const labels = new Map<string, string>();
    const videoIds = new Set(rows.filter((r) => r.modality === 'video').map((r) => r.external_id));
    if (videoIds.size > 0) for (const [k, v] of await collectVideoLabels(videoIds, maxPages)) labels.set(k, v);
    const imageIds = rows.filter((r) => r.modality === 'image').map((r) => r.external_id);
    if (imageIds.length > 0) for (const [k, v] of await collectImageLabels(imageIds)) labels.set(k, v);

    const labelCounts = new Map<string, number>();
    for (const v of labels.values()) labelCounts.set(v, (labelCounts.get(v) ?? 0) + 1);
    console.log('[relabelModels] donor labels:', Object.fromEntries([...labelCounts.entries()].sort((a, b) => b[1] - a[1])));

    const changes = planChanges(rows, labels);
    const modelChanges = changes.filter((c) => c.from !== c.to);
    console.log(`[relabelModels] rows to update: ${changes.length} (recommended model changes: ${modelChanges.length})`);
    console.log(summarize(modelChanges, rows));

    if (apply) {
      await applyChanges(client, changes);
      console.log('[relabelModels] applied');
    } else {
      console.log('DRY RUN — nothing written; pass --apply to write');
    }
  } finally {
    await client.end();
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error('[relabelModels] failed:', error);
    process.exit(1);
  });
}
