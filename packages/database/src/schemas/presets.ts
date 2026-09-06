import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const presets = pgTable(
  'presets',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    slug: text('slug').notNull().unique(),
    modality: text('modality').notNull(), // 'image' | 'video' — checked at app level
    recommendedModelId: text('recommended_model_id'),
    category: text('category').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    promptTemplate: text('prompt_template').notNull(),
    paramsLock: jsonb('params_lock')
      .notNull()
      .default(sql`'{}'::jsonb`),
    previewUrl: text('preview_url').notNull(),
    badges: text('badges')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(true),

    // --- attribution / ingest (0108_presets_attribution) ---
    /** Id of the item in the source catalogue; dedup key for the ingest job. */
    externalId: text('external_id').unique(),
    /** e.g. 'meigen' — where the item was ingested from. */
    sourcePlatform: text('source_platform'),
    /** Canonical link to the original post, shown as «Источник ↗». */
    sourceUrl: text('source_url'),
    authorName: text('author_name'),
    authorUrl: text('author_url'),
    authorAvatar: text('author_avatar'),
    /** Still frame shown before the mp4 preview loads. */
    posterUrl: text('poster_url'),
    /** Source-side popularity signal (likes) used for ranking. */
    popularity: integer('popularity'),
    /** True for image-to-video presets that need a reference image. */
    requiresImage: boolean('requires_image').notNull().default(false),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }),
    license: text('license'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    activeLookup: index('presets_modality_model_idx').on(
      t.modality,
      t.recommendedModelId,
      t.category,
      t.sortOrder,
    ),
  }),
);

export type PresetRow = typeof presets.$inferSelect;
