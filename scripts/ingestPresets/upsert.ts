/**
 * Database access for the ingest job.
 *
 * Deliberately a bare `pg` client rather than the app's drizzle server module:
 * this runs from system cron on the host, outside Next.js, and must not drag
 * in server env validation or the ORM's schema graph. The table is written
 * with `ON CONFLICT (external_id) DO NOTHING`, so a re-run is a no-op.
 */
import { Client } from 'pg';

import type { Modality, PresetInsert } from './types';

/** Model each modality is pinned to; matches what the curated rows use. */
export const DEFAULT_MODEL: Record<Modality, string> = {
  image: 'google/nano-banana-pro/text-to-image',
  video: 'bytedance/seedance-2.0-fast/text-to-video',
};

export const createClient = (connectionString?: string): Client => {
  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return new Client({ connectionString: url });
};

/** Every `external_id` we already hold — the incremental watermark. */
export const loadKnownExternalIds = async (client: Client): Promise<Set<string>> => {
  const { rows } = await client.query<{ external_id: string }>(
    'SELECT external_id FROM presets WHERE external_id IS NOT NULL',
  );
  return new Set(rows.map((row) => row.external_id));
};

/** New rows continue after the current maximum so ingested items sort last. */
export const maxSortOrder = async (client: Client): Promise<number> => {
  const { rows } = await client.query<{ max: number | null }>(
    'SELECT MAX(sort_order)::int AS max FROM presets',
  );
  return rows[0]?.max ?? 0;
};

/**
 * Insert one preset. Returns `false` when `external_id` already existed —
 * a benign race with a concurrent run, not an error.
 */
export const insertPreset = async (client: Client, row: PresetInsert): Promise<boolean> => {
  try {
    return await insertPresetRow(client, row);
  } catch (error) {
    // `slug` carries its own unique index; a curated row could already own
    // `trend-<id>` with a NULL external_id, which ON CONFLICT cannot absorb.
    if ((error as { code?: string }).code === '23505') return false;
    throw error;
  }
};

const insertPresetRow = async (client: Client, row: PresetInsert): Promise<boolean> => {
  const { rowCount } = await client.query(
    `INSERT INTO presets (
       slug, modality, recommended_model_id, category, title, prompt_template,
       params_lock, preview_url, poster_url, sort_order, active,
       external_id, source_platform, source_url,
       author_name, author_url, author_avatar,
       popularity, requires_image, ingested_at, license
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7::jsonb, $8, $9, $10, $11,
       $12, $13, $14,
       $15, $16, $17,
       $18, $19, NOW(), $20
     )
     ON CONFLICT (external_id) DO NOTHING`,
    [
      row.slug,
      row.modality,
      row.recommendedModelId,
      row.category,
      row.title,
      row.promptTemplate,
      JSON.stringify(row.paramsLock),
      row.previewUrl,
      row.posterUrl,
      row.sortOrder,
      row.active,
      row.externalId,
      row.sourcePlatform,
      row.sourceUrl,
      row.authorName,
      row.authorUrl,
      row.authorAvatar,
      row.popularity,
      row.requiresImage,
      row.license,
    ],
  );

  return (rowCount ?? 0) > 0;
};
