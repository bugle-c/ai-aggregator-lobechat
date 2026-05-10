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
    modelId: text('model_id').notNull(),
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    activeLookup: index('presets_modality_model_idx').on(
      t.modality,
      t.modelId,
      t.category,
      t.sortOrder,
    ),
  }),
);

export type PresetRow = typeof presets.$inferSelect;
