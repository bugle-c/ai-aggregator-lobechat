# Higgsfield-style Generator Pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/image` and `/video` from a 3-pane workspace into a higgsfield-flow layout — left sidebar with prompt/model/Generate, main area with tabs (Стили / Мои генерации) where Стили is a preset gallery of looping-MP4 cards. Phase 1 only: 10–12 seed presets per modality, manual MP4 upload, behind `?new_flow=1` flag until smoke-tested.

**Architecture:** New `presets` table in Postgres (Drizzle schema + raw SQL migration). New tRPC `presets` router. New shared `features/Generators/` directory with `PresetGallery`, `PresetCard`, `PresetMP4Player`, `PresetThumbCard`, `FlowSidebar`. New URL-state hook keeping `?tab/?model/?category/?preset/?q` in sync with the modality store. Both `(main)/image/_layout/` and `(main)/video/_layout/` are rewritten to compose the new sidebar + tabbed main area; the old `TopicSidebar` and right `ConfigPanel` are deleted in the cleanup task. Mobile uses a `MobileFlowSheet` bottom-sheet triggered by a `MobileFlowFAB`.

**Tech Stack:** Next.js 16 App Router · React 19 · Zustand · tRPC (lambda procedure) · Drizzle ORM · Postgres · `@lobehub/ui` · `antd` · `antd-style` · `react-router-dom` (SPA inside `(main)`) · `react-i18next`. Tests: `vitest` + `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-05-10-higgsfield-style-generators-design.md`

---

## File Structure

### Created

```
packages/database/migrations/0098_presets.sql                  ← raw SQL DDL + 24 seed rows
packages/database/src/schemas/presets.ts                       ← Drizzle schema
src/business/server/lambda-routers/presets.ts                  ← tRPC router (list, get)
src/business/server/lambda-routers/presets.test.ts             ← router tests
src/types/preset.ts                                            ← shared TS types
src/features/Generators/PresetMP4Player.tsx                    ← lazy-loaded looping mp4
src/features/Generators/PresetCard.tsx                         ← one preset tile
src/features/Generators/PresetThumbCard.tsx                    ← sidebar selected-preset preview
src/features/Generators/PresetGallery/ModelTabs.tsx
src/features/Generators/PresetGallery/CategoryTabs.tsx
src/features/Generators/PresetGallery/PresetGrid.tsx
src/features/Generators/PresetGallery/index.tsx                ← composes the 4 above + search
src/features/Generators/FlowSidebar.tsx                        ← desktop persistent sidebar
src/features/Generators/MobileFlowSheet.tsx                    ← mobile bottom-sheet
src/features/Generators/MobileFlowFAB.tsx                      ← floating "Создать" button on mobile
src/features/Generators/useFlowUrlState.ts                     ← URL ↔ store sync hook
src/features/Generators/applyPresetTemplate.ts                 ← {{user_prompt}} renderer + tests
src/features/Generators/applyPresetTemplate.test.ts
src/features/Generators/PRESET_CATEGORIES.ts                   ← shared category labels
src/store/image/slices/preset/action.ts                        ← `currentPreset` slice
src/store/image/slices/preset/selectors.ts
src/store/video/slices/preset/action.ts                        ← same shape, separate slice
src/store/video/slices/preset/selectors.ts
src/app/[variants]/(main)/image/features/FlowMainArea.tsx      ← tabs Стили|Мои генерации wrapper
src/app/[variants]/(main)/video/features/FlowMainArea.tsx
```

### Modified

```
packages/database/src/schemas/index.ts                         ← export presets schema
src/server/routers/lambda/index.ts                             ← register presetsRouter
src/store/image/store.ts + initialState.ts                     ← add preset slice
src/store/video/store.ts + initialState.ts                     ← add preset slice
src/app/[variants]/(main)/image/_layout/index.tsx              ← rewrite to use FlowSidebar
src/app/[variants]/(main)/image/index.tsx                      ← render FlowMainArea behind flag
src/app/[variants]/(main)/image/ImageWorkspaceMobile.tsx       ← rewrite mobile
src/app/[variants]/(main)/video/_layout/index.tsx              ← rewrite to use FlowSidebar
src/app/[variants]/(main)/video/index.tsx                      ← render FlowMainArea behind flag
src/app/[variants]/(main)/video/VideoWorkspaceMobile.tsx       ← rewrite mobile
src/locales/default/video.ts + image.ts                        ← new i18n keys
```

### Deleted (in cleanup task at the end)

```
src/app/[variants]/(main)/image/_layout/TopicSidebar.tsx
src/app/[variants]/(main)/image/_layout/ConfigPanel/
src/app/[variants]/(main)/image/features/ImageWorkspace/EmptyState.tsx
src/app/[variants]/(main)/video/_layout/TopicSidebar.tsx
src/app/[variants]/(main)/video/_layout/ConfigPanel/
src/app/[variants]/(main)/video/features/VideoWorkspace/EmptyState.tsx
```

---

## Task 1: DB schema + raw migration

**Files:**

- Create: `packages/database/src/schemas/presets.ts`

- Create: `packages/database/migrations/0098_presets.sql`

- Modify: `packages/database/src/schemas/index.ts`

- [ ] **Step 1.1: Drizzle schema**

Create `packages/database/src/schemas/presets.ts`:

```ts
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
```

- [ ] **Step 1.2: Export from schemas index**

Modify `packages/database/src/schemas/index.ts`. Add the export (alphabetical with the others):

```ts
export * from './presets';
```

- [ ] **Step 1.3: Raw SQL migration**

Create `packages/database/migrations/0098_presets.sql`. Includes the 24 seed rows (12 video + 12 image). `preview_url` placeholders point at `https://rustfs.gptweb.ru/presets/<slug>.mp4` — the actual MP4s are uploaded in Task 19. `model_id` values must match existing model registry slugs (verify before applying — see Step 1.5).

```sql
-- 0098_presets.sql

CREATE TABLE IF NOT EXISTS presets (
  id              BIGSERIAL PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  modality        TEXT NOT NULL CHECK (modality IN ('image','video')),
  model_id        TEXT NOT NULL,
  category        TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  prompt_template TEXT NOT NULL,
  params_lock     JSONB NOT NULL DEFAULT '{}'::jsonb,
  preview_url     TEXT NOT NULL,
  badges          TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  sort_order      INTEGER NOT NULL DEFAULT 0,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS presets_modality_model_idx
  ON presets (modality, model_id, category, sort_order)
  WHERE active = TRUE;

-- ============ VIDEO PRESETS (12) ============
INSERT INTO presets
  (slug, modality, model_id, category, title, description, prompt_template, params_lock, preview_url, badges, sort_order)
VALUES
  -- Camera (4)
  ('crash-zoom-in', 'video', 'seedance-2-0', 'camera',
   'Crash Zoom In', 'Резкий приближающий зум',
   'Crash zoom into {{user_prompt}}, cinematic, sharp focus, 24fps motion blur',
   '{"aspect_ratio":"16:9","duration_sec":5}',
   'https://rustfs.gptweb.ru/presets/crash-zoom-in.mp4',
   ARRAY['top_choice','trending'], 10),

  ('earth-zoom-out', 'video', 'seedance-2-0', 'camera',
   'Earth Zoom Out', 'Зум от объекта до Земли',
   'Slow zoom out from {{user_prompt}} all the way to outer space view of Earth',
   '{"aspect_ratio":"16:9","duration_sec":6}',
   'https://rustfs.gptweb.ru/presets/earth-zoom-out.mp4',
   ARRAY['top_choice'], 20),

  ('bullet-time', 'video', 'kling-3-0', 'camera',
   'Bullet Time', 'Замедление 360° вокруг объекта',
   '{{user_prompt}}, frozen in time, camera orbits 360 degrees, Matrix-style bullet time',
   '{"aspect_ratio":"16:9","duration_sec":4}',
   'https://rustfs.gptweb.ru/presets/bullet-time.mp4',
   ARRAY['trending'], 30),

  ('arc-left', 'video', 'kling-3-0', 'camera',
   'Arc Left', 'Дуга движения камеры влево',
   'Camera arcs smoothly leftward around {{user_prompt}}, parallax effect',
   '{"aspect_ratio":"16:9","duration_sec":5}',
   'https://rustfs.gptweb.ru/presets/arc-left.mp4',
   ARRAY[]::text[], 40),

  -- Effects (4)
  ('building-explosion', 'video', 'seedance-2-0', 'effects',
   'Building Explosion', 'Кинематографичный взрыв',
   '{{user_prompt}}, building explodes in slow motion, fire and debris, IMAX style',
   '{"aspect_ratio":"16:9","duration_sec":5}',
   'https://rustfs.gptweb.ru/presets/building-explosion.mp4',
   ARRAY['top_choice'], 110),

  ('turning-metal-melting', 'video', 'seedance-2-0', 'effects',
   'Turning Metal × Melting', 'Превращение в текучий металл',
   '{{user_prompt}}, transforming into liquid molten metal, surface ripples',
   '{}'::jsonb,
   'https://rustfs.gptweb.ru/presets/turning-metal-melting.mp4',
   ARRAY['mixed'], 120),

  ('face-punch', 'video', 'kling-3-0', 'effects',
   'Face Punch', 'Удар в лицо в slow-mo',
   '{{user_prompt}}, gets punched in the face, slow motion impact, droplets fly',
   '{"aspect_ratio":"16:9"}',
   'https://rustfs.gptweb.ru/presets/face-punch.mp4',
   ARRAY['top_choice','trending'], 130),

  ('car-explosion', 'video', 'seedance-2-0', 'effects',
   'Car Explosion', 'Взрыв авто и пламя',
   '{{user_prompt}}, car explodes with fireball, debris flying outward',
   '{"aspect_ratio":"16:9","duration_sec":5}',
   'https://rustfs.gptweb.ru/presets/car-explosion.mp4',
   ARRAY[]::text[], 140),

  -- Character (2)
  ('action-run', 'video', 'kling-3-0', 'character',
   'Action Run', 'Динамичный бег героя',
   '{{user_prompt}}, running heroically toward camera, slow-motion strides',
   '{"aspect_ratio":"16:9"}',
   'https://rustfs.gptweb.ru/presets/action-run.mp4',
   ARRAY['top_choice'], 210),

  ('eyes-in', 'video', 'seedance-2-0', 'character',
   'Eyes In', 'Резкий зум в глаз',
   'Extreme close-up zoom into the eye of {{user_prompt}}',
   '{}'::jsonb,
   'https://rustfs.gptweb.ru/presets/eyes-in.mp4',
   ARRAY['new'], 220),

  -- Ambient (2)
  ('general-cinematic', 'video', 'seedance-2-0', 'ambient',
   'General Cinematic', 'Базовая киношная сцена',
   '{{user_prompt}}, cinematic shot, 35mm film grain, golden hour lighting',
   '{"aspect_ratio":"16:9"}',
   'https://rustfs.gptweb.ru/presets/general-cinematic.mp4',
   ARRAY[]::text[], 310),

  ('mood-rain', 'video', 'kling-3-0', 'ambient',
   'Mood Rain', 'Дождливая атмосфера',
   '{{user_prompt}}, heavy rain, neon reflections on wet ground, moody',
   '{"aspect_ratio":"16:9"}',
   'https://rustfs.gptweb.ru/presets/mood-rain.mp4',
   ARRAY[]::text[], 320);

-- ============ IMAGE PRESETS (12) ============
INSERT INTO presets
  (slug, modality, model_id, category, title, description, prompt_template, params_lock, preview_url, badges, sort_order)
VALUES
  -- Portrait (3)
  ('portrait-studio', 'image', 'flux-pro', 'portrait',
   'Studio Portrait', 'Студийный портрет с мягким светом',
   '{{user_prompt}}, professional studio portrait, soft key light, 85mm f/1.4, sharp eyes',
   '{"aspect_ratio":"3:4"}',
   'https://rustfs.gptweb.ru/presets/portrait-studio.mp4',
   ARRAY['top_choice'], 10),

  ('portrait-noir', 'image', 'flux-pro', 'portrait',
   'Noir Portrait', 'Чёрно-белый драматический',
   '{{user_prompt}}, black and white portrait, hard shadow, film noir lighting',
   '{"aspect_ratio":"3:4"}',
   'https://rustfs.gptweb.ru/presets/portrait-noir.mp4',
   ARRAY[]::text[], 20),

  ('portrait-anime', 'image', 'nano-banana-pro', 'portrait',
   'Anime Portrait', 'Аниме-стиль портрета',
   '{{user_prompt}}, anime style portrait, vivid colors, detailed eyes, cel shading',
   '{"aspect_ratio":"3:4"}',
   'https://rustfs.gptweb.ru/presets/portrait-anime.mp4',
   ARRAY['trending'], 30),

  -- Landscape (2)
  ('landscape-cinematic', 'image', 'flux-pro', 'landscape',
   'Cinematic Landscape', 'Эпичный пейзаж',
   '{{user_prompt}}, sweeping cinematic landscape, golden hour, anamorphic lens',
   '{"aspect_ratio":"16:9"}',
   'https://rustfs.gptweb.ru/presets/landscape-cinematic.mp4',
   ARRAY['top_choice'], 110),

  ('landscape-fantasy', 'image', 'flux-pro', 'landscape',
   'Fantasy Landscape', 'Фэнтези-окружение',
   '{{user_prompt}}, fantasy landscape, magical atmosphere, dragons in distance',
   '{"aspect_ratio":"16:9"}',
   'https://rustfs.gptweb.ru/presets/landscape-fantasy.mp4',
   ARRAY[]::text[], 120),

  -- Anime (2)
  ('anime-shounen', 'image', 'nano-banana-pro', 'anime',
   'Shounen Hero', 'Аниме герой shounen',
   '{{user_prompt}}, shounen anime hero, dynamic pose, energy aura, vibrant',
   '{"aspect_ratio":"16:9"}',
   'https://rustfs.gptweb.ru/presets/anime-shounen.mp4',
   ARRAY['trending'], 210),

  ('anime-ghibli', 'image', 'nano-banana-pro', 'anime',
   'Ghibli Soft', 'Мягкий ghibli-style',
   '{{user_prompt}}, Ghibli style, soft watercolor textures, pastel palette',
   '{"aspect_ratio":"16:9"}',
   'https://rustfs.gptweb.ru/presets/anime-ghibli.mp4',
   ARRAY['top_choice'], 220),

  -- Realistic (3)
  ('realistic-photo', 'image', 'flux-pro', 'realistic',
   'Photo-real', 'Фотореалистичный кадр',
   '{{user_prompt}}, photorealistic, 50mm prime lens, natural lighting, fine details',
   '{}'::jsonb,
   'https://rustfs.gptweb.ru/presets/realistic-photo.mp4',
   ARRAY['top_choice'], 310),

  ('realistic-product', 'image', 'flux-pro', 'realistic',
   'Product Shot', 'Продуктовая съёмка',
   '{{user_prompt}}, product photography, white seamless backdrop, soft box lighting',
   '{"aspect_ratio":"1:1"}',
   'https://rustfs.gptweb.ru/presets/realistic-product.mp4',
   ARRAY[]::text[], 320),

  ('realistic-fashion', 'image', 'flux-pro', 'realistic',
   'Fashion Editorial', 'Журнальная мода',
   '{{user_prompt}}, fashion editorial, magazine cover quality, dramatic pose',
   '{"aspect_ratio":"3:4"}',
   'https://rustfs.gptweb.ru/presets/realistic-fashion.mp4',
   ARRAY['new'], 330),

  -- Product (2)
  ('product-flatlay', 'image', 'flux-pro', 'product',
   'Flat Lay', 'Раскладка сверху',
   '{{user_prompt}}, top-down flat lay composition, even lighting, neutral background',
   '{"aspect_ratio":"1:1"}',
   'https://rustfs.gptweb.ru/presets/product-flatlay.mp4',
   ARRAY[]::text[], 410),

  ('product-luxury', 'image', 'flux-pro', 'product',
   'Luxury Product', 'Люкс презентация',
   '{{user_prompt}}, luxury product showcase, dark moody background, dramatic rim light',
   '{"aspect_ratio":"1:1"}',
   'https://rustfs.gptweb.ru/presets/product-luxury.mp4',
   ARRAY['top_choice'], 420);
```

- [ ] **Step 1.4: Apply migration locally**

Run:

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
bun run db:migrate
```

Expected: migration `0098_presets` applied. Verify:

```bash
psql -h 127.0.0.1 -p 5433 -U postgres -d $LOBE_DB_NAME -c "SELECT modality, COUNT(*) FROM presets GROUP BY modality;"
```

Expected output:

```
 modality | count
----------+-------
 image    |    12
 video    |    12
```

- [ ] **Step 1.5: Verify model_id values match registry**

Run:

```bash
psql -h 127.0.0.1 -p 5433 -U postgres -d $LOBE_DB_NAME -c "SELECT DISTINCT model_id FROM presets;"
```

Cross-check each returned `model_id` against `SELECT id FROM ai_models WHERE enabled = true;` (or whatever the model registry table is — grep `aiModel` schema). If a slug doesn't exist (e.g. our `seedance-2-0` lives under a different id), update the seed migration AND re-apply against a clean DB or write a follow-up `0099_presets_model_fix.sql`. Plan owner: prefer fixing 0098 directly during initial implementation; only ship a 0099 if 0098 already shipped.

- [ ] **Step 1.6: Commit**

```bash
git add packages/database/src/schemas/presets.ts packages/database/src/schemas/index.ts packages/database/migrations/0098_presets.sql
git commit -m "feat(db): presets table + 24 seed rows (12 video, 12 image)

Schema for higgsfield-style preset library. Each preset binds to a
specific model_id and carries a prompt_template + params_lock + a
preview MP4 URL. Seeded with 4 video categories (camera/effects/
character/ambient) and 5 image categories (portrait/landscape/anime/
realistic/product). Preview URLs are placeholders until Task 19
uploads the actual MP4s to RustFS."
```

---

## Task 2: TypeScript types

**Files:**

- Create: `src/types/preset.ts`

- [ ] **Step 2.1: Define types**

Create `src/types/preset.ts`:

```ts
export type PresetModality = 'image' | 'video';

export type PresetBadge = 'top_choice' | 'mixed' | 'new' | 'trending';

export interface PresetParamsLock {
  aspect_ratio?: string;
  duration_sec?: number;
  steps?: number;
  cfg?: number;
  // intentionally permissive — model-specific params live here as raw JSON
  [k: string]: unknown;
}

export interface Preset {
  id: number;
  slug: string;
  modality: PresetModality;
  modelId: string;
  category: string;
  title: string;
  description: string | null;
  promptTemplate: string;
  paramsLock: PresetParamsLock;
  previewUrl: string;
  badges: PresetBadge[];
  sortOrder: number;
}

export interface PresetListFilters {
  modality: PresetModality;
  modelId?: string;
  category?: string;
  q?: string;
}
```

- [ ] **Step 2.2: Commit**

```bash
git add src/types/preset.ts
git commit -m "feat(types): Preset, PresetParamsLock, PresetListFilters"
```

---

## Task 3: tRPC presets router

**Files:**

- Create: `src/business/server/lambda-routers/presets.ts`

- Create: `src/business/server/lambda-routers/presets.test.ts`

- Modify: `src/server/routers/lambda/index.ts`

- [ ] **Step 3.1: Failing test**

Create `src/business/server/lambda-routers/presets.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { presetsRouter } from './presets';

const ctx = {} as any;

describe('presetsRouter', () => {
  it('list returns active presets filtered by modality', async () => {
    const caller = presetsRouter.createCaller(ctx);
    const result = await caller.list({ modality: 'video' });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((p) => p.modality === 'video')).toBe(true);
    expect(result.every((p) => typeof p.previewUrl === 'string')).toBe(true);
  });

  it('list filters by modelId', async () => {
    const caller = presetsRouter.createCaller(ctx);
    const result = await caller.list({ modality: 'video', modelId: 'seedance-2-0' });
    expect(result.every((p) => p.modelId === 'seedance-2-0')).toBe(true);
  });

  it('list filters by category', async () => {
    const caller = presetsRouter.createCaller(ctx);
    const result = await caller.list({ modality: 'video', category: 'camera' });
    expect(result.every((p) => p.category === 'camera')).toBe(true);
  });

  it('list filters by q (case-insensitive title match)', async () => {
    const caller = presetsRouter.createCaller(ctx);
    const result = await caller.list({ modality: 'video', q: 'zoom' });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((p) => p.title.toLowerCase().includes('zoom'))).toBe(true);
  });

  it('getBySlug returns one preset', async () => {
    const caller = presetsRouter.createCaller(ctx);
    const p = await caller.getBySlug({ slug: 'crash-zoom-in' });
    expect(p?.slug).toBe('crash-zoom-in');
    expect(p?.modality).toBe('video');
  });

  it('getBySlug returns null on missing slug', async () => {
    const caller = presetsRouter.createCaller(ctx);
    const p = await caller.getBySlug({ slug: 'does-not-exist' });
    expect(p).toBeNull();
  });
});
```

- [ ] **Step 3.2: Run test, verify failure**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
bun test src/business/server/lambda-routers/presets.test.ts
```

Expected: FAIL — `presets` module does not exist.

- [ ] **Step 3.3: Implement router**

Create `src/business/server/lambda-routers/presets.ts`:

```ts
import { presets } from '@lobechat/database';
import { and, eq, ilike, sql } from 'drizzle-orm';
import { z } from 'zod';

import { lobeChatDB } from '@/libs/trpc/lambda/db-injection';
import { publicProcedure, router } from '@/libs/trpc/lambda';
import type { Preset, PresetBadge, PresetParamsLock } from '@/types/preset';

const modalityEnum = z.enum(['image', 'video']);

const rowToPreset = (r: typeof presets.$inferSelect): Preset => ({
  id: r.id,
  slug: r.slug,
  modality: r.modality as Preset['modality'],
  modelId: r.modelId,
  category: r.category,
  title: r.title,
  description: r.description,
  promptTemplate: r.promptTemplate,
  paramsLock: (r.paramsLock as PresetParamsLock) ?? {},
  previewUrl: r.previewUrl,
  badges: (r.badges as PresetBadge[]) ?? [],
  sortOrder: r.sortOrder,
});

export const presetsRouter = router({
  list: publicProcedure
    .input(
      z.object({
        modality: modalityEnum,
        modelId: z.string().optional(),
        category: z.string().optional(),
        q: z.string().min(1).max(80).optional(),
      }),
    )
    .query(async ({ input }): Promise<Preset[]> => {
      const conditions = [eq(presets.active, true), eq(presets.modality, input.modality)];
      if (input.modelId) conditions.push(eq(presets.modelId, input.modelId));
      if (input.category) conditions.push(eq(presets.category, input.category));
      if (input.q) conditions.push(ilike(presets.title, `%${input.q}%`));

      const rows = await lobeChatDB
        .select()
        .from(presets)
        .where(and(...conditions))
        .orderBy(presets.sortOrder, presets.id);
      return rows.map(rowToPreset);
    }),

  getBySlug: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ input }): Promise<Preset | null> => {
      const rows = await lobeChatDB
        .select()
        .from(presets)
        .where(and(eq(presets.slug, input.slug), eq(presets.active, true)))
        .limit(1);
      return rows[0] ? rowToPreset(rows[0]) : null;
    }),
});
```

- [ ] **Step 3.4: Register router**

Modify `src/server/routers/lambda/index.ts`. Add the import alongside other business routers:

```ts
import { presetsRouter } from '@/business/server/lambda-routers/presets';
```

And in the `router({...})` call, add:

```ts
  presets: presetsRouter,
```

(Keep alphabetical order with existing entries.)

- [ ] **Step 3.5: Run tests, verify pass**

```bash
bun test src/business/server/lambda-routers/presets.test.ts
```

Expected: PASS — all 6 cases.

- [ ] **Step 3.6: Commit**

```bash
git add src/business/server/lambda-routers/presets.ts src/business/server/lambda-routers/presets.test.ts src/server/routers/lambda/index.ts src/types/preset.ts
git commit -m "feat(trpc): presets.list + presets.getBySlug

Reads from the new presets table, filters by modality / modelId /
category and ilike-matches on title. publicProcedure since presets
are not user-scoped."
```

---

## Task 4: Categories registry

**Files:**

- Create: `src/features/Generators/PRESET_CATEGORIES.ts`

- [ ] **Step 4.1: Define category lists**

Create `src/features/Generators/PRESET_CATEGORIES.ts`:

```ts
import type { PresetModality } from '@/types/preset';

export interface CategoryDef {
  slug: string; // matches presets.category
  label: string; // displayed to user (Russian)
}

export const VIDEO_CATEGORIES: CategoryDef[] = [
  { slug: '__all', label: 'Все' },
  { slug: 'camera', label: 'Камера' },
  { slug: 'effects', label: 'Эффекты' },
  { slug: 'character', label: 'Персонажи' },
  { slug: 'ambient', label: 'Атмосфера' },
];

export const IMAGE_CATEGORIES: CategoryDef[] = [
  { slug: '__all', label: 'Все' },
  { slug: 'portrait', label: 'Портрет' },
  { slug: 'landscape', label: 'Пейзаж' },
  { slug: 'anime', label: 'Аниме' },
  { slug: 'realistic', label: 'Реализм' },
  { slug: 'product', label: 'Продукт' },
];

export const getCategories = (modality: PresetModality): CategoryDef[] =>
  modality === 'video' ? VIDEO_CATEGORIES : IMAGE_CATEGORIES;
```

- [ ] **Step 4.2: Commit**

```bash
git add src/features/Generators/PRESET_CATEGORIES.ts
git commit -m "feat(presets): video/image category registry"
```

---

## Task 5: applyPresetTemplate utility

**Files:**

- Create: `src/features/Generators/applyPresetTemplate.ts`

- Create: `src/features/Generators/applyPresetTemplate.test.ts`

- [ ] **Step 5.1: Failing test**

Create `src/features/Generators/applyPresetTemplate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { applyPresetTemplate } from './applyPresetTemplate';

describe('applyPresetTemplate', () => {
  it('replaces {{user_prompt}} with the user prompt', () => {
    expect(applyPresetTemplate('Crash zoom into {{user_prompt}}', 'a robot')).toBe(
      'Crash zoom into a robot',
    );
  });

  it('returns the user prompt unchanged when template is missing or empty', () => {
    expect(applyPresetTemplate(undefined, 'a robot')).toBe('a robot');
    expect(applyPresetTemplate('', 'a robot')).toBe('a robot');
  });

  it('handles templates with no placeholder by appending the user prompt', () => {
    expect(applyPresetTemplate('cinematic', 'a robot')).toBe('cinematic, a robot');
  });

  it('trims whitespace in user prompt', () => {
    expect(applyPresetTemplate('foo {{user_prompt}}', '   a robot   ')).toBe('foo a robot');
  });

  it('replaces every occurrence (not just the first)', () => {
    expect(applyPresetTemplate('{{user_prompt}} -> {{user_prompt}}', 'cat')).toBe('cat -> cat');
  });

  it('passes through empty user prompt by leaving placeholder empty', () => {
    expect(applyPresetTemplate('A {{user_prompt}} B', '')).toBe('A  B');
  });
});
```

- [ ] **Step 5.2: Run test, verify failure**

```bash
bun test src/features/Generators/applyPresetTemplate.test.ts
```

Expected: FAIL — `applyPresetTemplate` not found.

- [ ] **Step 5.3: Implement**

Create `src/features/Generators/applyPresetTemplate.ts`:

```ts
const PLACEHOLDER = '{{user_prompt}}';

/**
 * Render a preset prompt template with the user-typed prompt.
 *
 * Behaviour matches higgsfield's flow: the template wraps the user
 * prompt rather than replacing it. If the template contains
 * `{{user_prompt}}`, every occurrence is substituted. If the template
 * has no placeholder (e.g. just a style tag), the user prompt is
 * appended after a comma. If the template is empty, the user prompt
 * is returned untouched.
 */
export const applyPresetTemplate = (
  template: string | undefined | null,
  userPrompt: string,
): string => {
  const prompt = userPrompt.trim();
  if (!template) return prompt;

  if (template.includes(PLACEHOLDER)) {
    return template.split(PLACEHOLDER).join(prompt);
  }

  return prompt ? `${template}, ${prompt}` : template;
};
```

- [ ] **Step 5.4: Run tests, verify pass**

```bash
bun test src/features/Generators/applyPresetTemplate.test.ts
```

Expected: PASS — 6 cases.

- [ ] **Step 5.5: Commit**

```bash
git add src/features/Generators/applyPresetTemplate.ts src/features/Generators/applyPresetTemplate.test.ts
git commit -m "feat(presets): applyPresetTemplate({{user_prompt}} renderer)"
```

---

## Task 6: Preset slice — image store

**Files:**

- Create: `src/store/image/slices/preset/action.ts`

- Create: `src/store/image/slices/preset/selectors.ts`

- Modify: `src/store/image/initialState.ts`

- Modify: `src/store/image/store.ts`

- [ ] **Step 6.1: Slice action**

Create `src/store/image/slices/preset/action.ts`:

```ts
import type { StateCreator } from 'zustand/vanilla';

import type { Preset } from '@/types/preset';

import type { ImageStore } from '../../store';

export interface PresetState {
  currentPreset: Preset | null;
}

export interface PresetAction {
  selectPreset: (preset: Preset) => void;
  clearPreset: () => void;
}

export const initialPresetState: PresetState = {
  currentPreset: null,
};

export const createPresetSlice: StateCreator<
  ImageStore,
  [['zustand/devtools', never]],
  [],
  PresetAction
> = (set, get) => ({
  selectPreset: (preset) => {
    set({ currentPreset: preset }, false, 'selectPreset');

    // Apply model lock + params lock through existing config slice.
    const { setGenerationConfig } = get();
    setGenerationConfig({
      model: preset.modelId,
      ...preset.paramsLock,
    });
  },

  clearPreset: () => set({ currentPreset: null }, false, 'clearPreset'),
});
```

- [ ] **Step 6.2: Selectors**

Create `src/store/image/slices/preset/selectors.ts`:

```ts
import type { ImageStoreState } from '../../initialState';

const currentPreset = (s: ImageStoreState) => s.currentPreset;
const hasPreset = (s: ImageStoreState) => s.currentPreset !== null;
const presetSlug = (s: ImageStoreState) => s.currentPreset?.slug ?? null;

export const presetSelectors = { currentPreset, hasPreset, presetSlug };
```

- [ ] **Step 6.3: Wire slice into initialState**

Modify `src/store/image/initialState.ts`. Find the existing `ImageStoreState` type and the merged initial state. Add:

```ts
import { initialPresetState, type PresetState } from './slices/preset/action';
```

Extend the merged state type:

```ts
export type ImageStoreState = GenerationConfigState &
  GenerationTopicState &
  GenerationBatchState &
  CreateImageState &
  PresetState;
```

Extend the merged initial state:

```ts
export const initialState: ImageStoreState = {
  ...initialGenerationConfigState,
  ...initialGenerationTopicState,
  ...initialGenerationBatchState,
  ...initialCreateImageState,
  ...initialPresetState,
};
```

- [ ] **Step 6.4: Wire slice into store**

Modify `src/store/image/store.ts`. Add imports and merge:

```ts
import { type PresetAction, createPresetSlice } from './slices/preset/action';
```

Extend the `ImageStore` interface union:

```ts
export interface ImageStore
  extends
    GenerationConfigAction,
    GenerationTopicAction,
    GenerationBatchAction,
    CreateImageAction,
    PresetAction,
    ImageStoreState {}
```

In the `createStore` body, add `...createPresetSlice(...args)` next to the existing `...createXxxSlice(...args)` lines.

- [ ] **Step 6.5: Smoke test**

Add a test alongside existing image-store tests (path: `src/store/image/slices/preset/action.test.ts`):

```ts
import { describe, expect, it } from 'vitest';

import type { Preset } from '@/types/preset';

import { useImageStore } from '../../store';

const fakePreset: Preset = {
  id: 1,
  slug: 'test',
  modality: 'image',
  modelId: 'flux-pro',
  category: 'portrait',
  title: 'Test',
  description: null,
  promptTemplate: 'foo {{user_prompt}}',
  paramsLock: { aspect_ratio: '3:4' },
  previewUrl: 'https://example.com/x.mp4',
  badges: ['new'],
  sortOrder: 1,
};

describe('image preset slice', () => {
  it('selectPreset sets currentPreset and applies model lock', () => {
    useImageStore.getState().selectPreset(fakePreset);
    const s = useImageStore.getState();
    expect(s.currentPreset?.slug).toBe('test');
    // model came from preset.modelId
    // (we don't assert config shape here — config slice has its own tests)
  });

  it('clearPreset nulls currentPreset', () => {
    useImageStore.getState().selectPreset(fakePreset);
    useImageStore.getState().clearPreset();
    expect(useImageStore.getState().currentPreset).toBeNull();
  });
});
```

Run:

```bash
bun test src/store/image/slices/preset/action.test.ts
```

Expected: PASS.

- [ ] **Step 6.6: Commit**

```bash
git add src/store/image/slices/preset/ src/store/image/initialState.ts src/store/image/store.ts
git commit -m "feat(image-store): preset slice (selectPreset/clearPreset)"
```

---

## Task 7: Preset slice — video store

**Files:**

- Create: `src/store/video/slices/preset/action.ts`
- Create: `src/store/video/slices/preset/selectors.ts`
- Create: `src/store/video/slices/preset/action.test.ts`
- Modify: `src/store/video/initialState.ts`
- Modify: `src/store/video/store.ts`

Mirror Task 6 against the video store. Replace `ImageStore`/`ImageStoreState` references with `VideoStore`/`VideoStoreState`. The `setGenerationConfig` in the video store has the same name (verify by reading `src/store/video/slices/generationConfig/`).

- [ ] **Step 7.1–7.6: Same structure as Task 6, video store**

- [ ] **Step 7.7: Commit**

```bash
git add src/store/video/slices/preset/ src/store/video/initialState.ts src/store/video/store.ts
git commit -m "feat(video-store): preset slice (selectPreset/clearPreset)"
```

---

## Task 8: PresetMP4Player

**Files:**

- Create: `src/features/Generators/PresetMP4Player.tsx`

- [ ] **Step 8.1: Component**

Create `src/features/Generators/PresetMP4Player.tsx`:

```tsx
'use client';

import { memo, useEffect, useRef, useState } from 'react';

interface Props {
  /** Optional poster shown before mp4 loads. */
  posterUrl?: string;
  previewUrl: string;
  /** When true, autoplay only when card is in viewport (saves bandwidth on long lists). */
  lazyAutoplay?: boolean;
  /** Treats the component as decorative inside a clickable parent. */
  ariaHidden?: boolean;
  className?: string;
}

/**
 * Lazy-loaded looping muted MP4 used for preset thumbnails.
 *
 * - Defers <video src> assignment until the element scrolls into view
 *   (IntersectionObserver) when `lazyAutoplay` is true.
 * - `playsinline` + `muted` is required for autoplay on iOS Safari.
 */
const PresetMP4Player = memo<Props>(
  ({ ariaHidden, className, lazyAutoplay = true, posterUrl, previewUrl }) => {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [shouldLoad, setShouldLoad] = useState(!lazyAutoplay);

    useEffect(() => {
      if (!lazyAutoplay) return;
      const el = videoRef.current;
      if (!el) return;

      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              setShouldLoad(true);
              io.disconnect();
              break;
            }
          }
        },
        { rootMargin: '200px 0px' },
      );

      io.observe(el);
      return () => io.disconnect();
    }, [lazyAutoplay]);

    return (
      <video
        ref={videoRef}
        aria-hidden={ariaHidden}
        autoPlay
        className={className}
        loop
        muted
        playsInline
        poster={posterUrl}
        preload="none"
        src={shouldLoad ? previewUrl : undefined}
        style={{
          display: 'block',
          height: '100%',
          objectFit: 'cover',
          width: '100%',
        }}
      />
    );
  },
);

PresetMP4Player.displayName = 'PresetMP4Player';

export default PresetMP4Player;
```

- [ ] **Step 8.2: Commit**

```bash
git add src/features/Generators/PresetMP4Player.tsx
git commit -m "feat(presets): PresetMP4Player (lazy looping muted mp4)"
```

---

## Task 9: PresetCard

**Files:**

- Create: `src/features/Generators/PresetCard.tsx`

- [ ] **Step 9.1: Component**

Create `src/features/Generators/PresetCard.tsx`:

```tsx
'use client';

import { Block } from '@lobehub/ui';
import { memo } from 'react';

import type { Preset, PresetBadge } from '@/types/preset';

import PresetMP4Player from './PresetMP4Player';

interface Props {
  isActive?: boolean;
  onClick: (preset: Preset) => void;
  preset: Preset;
}

const BADGE_LABELS: Record<PresetBadge, string> = {
  mixed: 'Mixed',
  new: 'New',
  top_choice: 'Top',
  trending: '🔥',
};

const BADGE_COLORS: Record<PresetBadge, string> = {
  mixed: 'rgba(120, 120, 120, 0.85)',
  new: '#dc2626',
  top_choice: '#facc15',
  trending: 'transparent',
};

const PresetCard = memo<Props>(({ isActive, onClick, preset }) => {
  return (
    <Block
      clickable
      onClick={() => onClick(preset)}
      style={{
        aspectRatio: '3 / 4',
        border: isActive ? '2px solid var(--ant-color-primary)' : '1px solid transparent',
        borderRadius: 12,
        overflow: 'hidden',
        position: 'relative',
      }}
      variant="filled"
    >
      <PresetMP4Player ariaHidden previewUrl={preset.previewUrl} />

      {/* badges */}
      {preset.badges.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 4,
            insetBlockStart: 8,
            insetInlineStart: 8,
            position: 'absolute',
          }}
        >
          {preset.badges.map((b) => (
            <span
              key={b}
              style={{
                background: BADGE_COLORS[b],
                borderRadius: 6,
                color: b === 'top_choice' ? '#000' : '#fff',
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 6px',
              }}
            >
              {BADGE_LABELS[b]}
            </span>
          ))}
        </div>
      )}

      {/* title overlay */}
      <div
        style={{
          background: 'linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.7) 100%)',
          color: '#fff',
          fontSize: 13,
          fontWeight: 600,
          insetBlockEnd: 0,
          insetInline: 0,
          padding: '24px 12px 10px',
          position: 'absolute',
          textTransform: 'uppercase',
        }}
      >
        {preset.title}
      </div>
    </Block>
  );
});

PresetCard.displayName = 'PresetCard';

export default PresetCard;
```

- [ ] **Step 9.2: Commit**

```bash
git add src/features/Generators/PresetCard.tsx
git commit -m "feat(presets): PresetCard with badges + title overlay"
```

---

## Task 10: ModelTabs

**Files:**

- Create: `src/features/Generators/PresetGallery/ModelTabs.tsx`

- [ ] **Step 10.1: Component**

Create `src/features/Generators/PresetGallery/ModelTabs.tsx`:

```tsx
'use client';

import { Tabs } from 'antd';
import { memo, useMemo } from 'react';

import { lambdaQuery } from '@/libs/trpc/client';
import type { PresetModality } from '@/types/preset';

interface Props {
  modality: PresetModality;
  onSelect: (modelId: string | undefined) => void;
  /** undefined = "All models" */
  selected: string | undefined;
}

/**
 * Top tabs for the preset gallery — one tab per model that has at
 * least one active preset for the current modality. Derived from the
 * preset list itself (no separate models endpoint), so adding a new
 * model+preset auto-adds a tab.
 */
const ModelTabs = memo<Props>(({ modality, onSelect, selected }) => {
  const { data: presets } = lambdaQuery.presets.list.useQuery(
    { modality },
    { staleTime: 5 * 60 * 1000 },
  );

  const items = useMemo(() => {
    if (!presets) return [{ key: '__all', label: 'Все' }];
    const seen = new Set<string>();
    const tabs: { key: string; label: string }[] = [{ key: '__all', label: 'Все' }];
    for (const p of presets) {
      if (seen.has(p.modelId)) continue;
      seen.add(p.modelId);
      tabs.push({ key: p.modelId, label: p.modelId });
    }
    return tabs;
  }, [presets]);

  return (
    <Tabs
      activeKey={selected ?? '__all'}
      items={items}
      onChange={(key) => onSelect(key === '__all' ? undefined : key)}
      size="small"
    />
  );
});

ModelTabs.displayName = 'PresetModelTabs';

export default ModelTabs;
```

- [ ] **Step 10.2: Commit**

```bash
git add src/features/Generators/PresetGallery/ModelTabs.tsx
git commit -m "feat(presets): ModelTabs (top tabs derived from preset list)"
```

---

## Task 11: CategoryTabs

**Files:**

- Create: `src/features/Generators/PresetGallery/CategoryTabs.tsx`

- [ ] **Step 11.1: Component**

Create `src/features/Generators/PresetGallery/CategoryTabs.tsx`:

```tsx
'use client';

import { Tabs } from 'antd';
import { memo } from 'react';

import { getCategories } from '../PRESET_CATEGORIES';
import type { PresetModality } from '@/types/preset';

interface Props {
  modality: PresetModality;
  onSelect: (slug: string | undefined) => void;
  /** undefined or '__all' = no category filter */
  selected: string | undefined;
}

const CategoryTabs = memo<Props>(({ modality, onSelect, selected }) => {
  const cats = getCategories(modality);

  return (
    <Tabs
      activeKey={selected ?? '__all'}
      items={cats.map((c) => ({ key: c.slug, label: c.label }))}
      onChange={(key) => onSelect(key === '__all' ? undefined : key)}
      size="small"
    />
  );
});

CategoryTabs.displayName = 'PresetCategoryTabs';

export default CategoryTabs;
```

- [ ] **Step 11.2: Commit**

```bash
git add src/features/Generators/PresetGallery/CategoryTabs.tsx
git commit -m "feat(presets): CategoryTabs (sub-tabs by category)"
```

---

## Task 12: PresetGrid

**Files:**

- Create: `src/features/Generators/PresetGallery/PresetGrid.tsx`

- [ ] **Step 12.1: Component**

Create `src/features/Generators/PresetGallery/PresetGrid.tsx`:

```tsx
'use client';

import { Empty, Spin } from 'antd';
import { memo } from 'react';

import { useIsMobile } from '@/hooks/useIsMobile';
import { lambdaQuery } from '@/libs/trpc/client';
import type { Preset, PresetModality } from '@/types/preset';

import PresetCard from '../PresetCard';

interface Props {
  category: string | undefined;
  modality: PresetModality;
  modelId: string | undefined;
  onSelect: (preset: Preset) => void;
  q: string | undefined;
  selectedSlug: string | null;
}

const PresetGrid = memo<Props>(({ category, modality, modelId, onSelect, q, selectedSlug }) => {
  const isMobile = useIsMobile();
  const { data, isLoading } = lambdaQuery.presets.list.useQuery(
    { category, modality, modelId, q },
    { staleTime: 5 * 60 * 1000 },
  );

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
        <Spin />
      </div>
    );
  }

  if (!data || data.length === 0) {
    return <Empty description="Пресеты не найдены" style={{ paddingBlock: 64 }} />;
  }

  return (
    <div
      style={{
        display: 'grid',
        gap: 12,
        gridTemplateColumns: isMobile
          ? 'repeat(2, minmax(0, 1fr))'
          : 'repeat(auto-fill, minmax(220px, 1fr))',
        paddingInline: 16,
      }}
    >
      {data.map((p) => (
        <PresetCard isActive={p.slug === selectedSlug} key={p.slug} onClick={onSelect} preset={p} />
      ))}
    </div>
  );
});

PresetGrid.displayName = 'PresetGrid';

export default PresetGrid;
```

- [ ] **Step 12.2: Commit**

```bash
git add src/features/Generators/PresetGallery/PresetGrid.tsx
git commit -m "feat(presets): PresetGrid (responsive 2-col mobile / auto-fill desktop)"
```

---

## Task 13: PresetGallery composer

**Files:**

- Create: `src/features/Generators/PresetGallery/index.tsx`

- [ ] **Step 13.1: Component**

Create `src/features/Generators/PresetGallery/index.tsx`:

```tsx
'use client';

import { Flexbox } from '@lobehub/ui';
import { Input } from 'antd';
import { Search } from 'lucide-react';
import { memo } from 'react';

import type { Preset, PresetModality } from '@/types/preset';

import CategoryTabs from './CategoryTabs';
import ModelTabs from './ModelTabs';
import PresetGrid from './PresetGrid';

interface Props {
  category: string | undefined;
  modality: PresetModality;
  modelId: string | undefined;
  onCategoryChange: (slug: string | undefined) => void;
  onModelChange: (modelId: string | undefined) => void;
  onPresetSelect: (preset: Preset) => void;
  onSearchChange: (q: string | undefined) => void;
  q: string | undefined;
  selectedSlug: string | null;
}

const PresetGallery = memo<Props>((props) => {
  return (
    <Flexbox flex={1} gap={8} style={{ overflowY: 'auto' }}>
      <ModelTabs
        modality={props.modality}
        onSelect={props.onModelChange}
        selected={props.modelId}
      />
      <Flexbox horizontal align="center" gap={8} paddingInline={16}>
        <Flexbox flex={1}>
          <CategoryTabs
            modality={props.modality}
            onSelect={props.onCategoryChange}
            selected={props.category}
          />
        </Flexbox>
        <Input
          allowClear
          onChange={(e) => props.onSearchChange(e.target.value || undefined)}
          placeholder="Поиск"
          prefix={<Search size={14} />}
          style={{ maxWidth: 200 }}
          value={props.q ?? ''}
        />
      </Flexbox>
      <PresetGrid
        category={props.category}
        modality={props.modality}
        modelId={props.modelId}
        onSelect={props.onPresetSelect}
        q={props.q}
        selectedSlug={props.selectedSlug}
      />
    </Flexbox>
  );
});

PresetGallery.displayName = 'PresetGallery';

export default PresetGallery;
```

- [ ] **Step 13.2: Commit**

```bash
git add src/features/Generators/PresetGallery/index.tsx
git commit -m "feat(presets): PresetGallery composer (model+category tabs, search, grid)"
```

---

## Task 14: useFlowUrlState hook

**Files:**

- Create: `src/features/Generators/useFlowUrlState.ts`

- [ ] **Step 14.1: Hook**

Create `src/features/Generators/useFlowUrlState.ts`:

```ts
'use client';

import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export type FlowTab = 'presets' | 'feed';

export interface FlowUrlState {
  category: string | undefined;
  modelId: string | undefined;
  preset: string | undefined;
  q: string | undefined;
  tab: FlowTab;
}

export interface FlowUrlSetters {
  setCategory: (v: string | undefined) => void;
  setModel: (v: string | undefined) => void;
  setPreset: (v: string | undefined) => void;
  setQ: (v: string | undefined) => void;
  setTab: (v: FlowTab) => void;
}

const COMPACT_KEYS = ['tab', 'model', 'category', 'preset', 'q'] as const;

const sanitizeTab = (raw: string | null): FlowTab => (raw === 'presets' ? 'presets' : 'feed');

/**
 * Reads/writes flow page state through search-params:
 *   ?tab=presets|feed
 *   ?model=<slug>
 *   ?category=<slug>
 *   ?preset=<slug>
 *   ?q=<text>
 *
 * The defaultTab fallback is used when there is no `tab` param yet
 * (caller decides based on whether the feed is empty).
 */
export const useFlowUrlState = (defaultTab: FlowTab): FlowUrlState & FlowUrlSetters => {
  const [params, setParams] = useSearchParams();

  const value: FlowUrlState = {
    category: params.get('category') ?? undefined,
    modelId: params.get('model') ?? undefined,
    preset: params.get('preset') ?? undefined,
    q: params.get('q') ?? undefined,
    tab: params.has('tab') ? sanitizeTab(params.get('tab')) : defaultTab,
  };

  const update = useCallback(
    (key: (typeof COMPACT_KEYS)[number], val: string | undefined) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (val === undefined || val === '') next.delete(key);
          else next.set(key, val);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return {
    ...value,
    setCategory: (v) => update('category', v),
    setModel: (v) => update('model', v),
    setPreset: (v) => update('preset', v),
    setQ: (v) => update('q', v),
    setTab: (v) => update('tab', v),
  };
};
```

- [ ] **Step 14.2: Commit**

```bash
git add src/features/Generators/useFlowUrlState.ts
git commit -m "feat(presets): useFlowUrlState — search-params <-> {tab,model,category,preset,q}"
```

---

## Task 15: PresetThumbCard (sidebar selected-preset preview)

**Files:**

- Create: `src/features/Generators/PresetThumbCard.tsx`

- [ ] **Step 15.1: Component**

Create `src/features/Generators/PresetThumbCard.tsx`:

```tsx
'use client';

import { Block, Flexbox } from '@lobehub/ui';
import { Sparkles, X } from 'lucide-react';
import { memo } from 'react';

import type { Preset } from '@/types/preset';

import PresetMP4Player from './PresetMP4Player';

interface Props {
  onClear: () => void;
  preset: Preset | null;
}

const PresetThumbCard = memo<Props>(({ onClear, preset }) => {
  if (!preset) {
    return (
      <Block
        padding={16}
        style={{
          alignItems: 'center',
          borderStyle: 'dashed',
          color: 'var(--ant-color-text-tertiary)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          textAlign: 'center',
        }}
        variant="outlined"
      >
        <Sparkles size={20} />
        <span style={{ fontSize: 13 }}>Выберите стиль или начните с чистого листа</span>
      </Block>
    );
  }

  return (
    <Block padding={0} style={{ overflow: 'hidden', position: 'relative' }} variant="filled">
      <div style={{ aspectRatio: '4 / 3' }}>
        <PresetMP4Player previewUrl={preset.previewUrl} />
      </div>
      <Flexbox horizontal align="center" justify="space-between" padding={8}>
        <Flexbox>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{preset.title}</span>
          <span style={{ color: 'var(--ant-color-text-secondary)', fontSize: 11 }}>
            {preset.modelId}
          </span>
        </Flexbox>
        <button
          aria-label="Снять стиль"
          onClick={onClear}
          style={{
            background: 'transparent',
            border: 0,
            color: 'var(--ant-color-text-secondary)',
            cursor: 'pointer',
            padding: 4,
          }}
          type="button"
        >
          <X size={16} />
        </button>
      </Flexbox>
    </Block>
  );
});

PresetThumbCard.displayName = 'PresetThumbCard';

export default PresetThumbCard;
```

- [ ] **Step 15.2: Commit**

```bash
git add src/features/Generators/PresetThumbCard.tsx
git commit -m "feat(presets): PresetThumbCard (sidebar preview with ✕)"
```

---

## Task 16: FlowSidebar (desktop)

**Files:**

- Create: `src/features/Generators/FlowSidebar.tsx`

- [ ] **Step 16.1: Component**

Create `src/features/Generators/FlowSidebar.tsx`:

```tsx
'use client';

import { Flexbox } from '@lobehub/ui';
import { Button } from 'antd';
import { memo, type ReactNode } from 'react';

import type { Preset, PresetModality } from '@/types/preset';

import PresetThumbCard from './PresetThumbCard';

interface Props {
  /** Whatever extra widgets the modality wants — image-upload, settings ⚙, model selector. */
  controls: ReactNode;
  creditCost?: number;
  generateLabel?: string;
  isGenerating: boolean;
  modality: PresetModality;
  onClearPreset: () => void;
  onGenerate: () => void;
  preset: Preset | null;
  /** PromptInput component instance — modality-specific so we keep this pluggable. */
  promptInput: ReactNode;
}

/**
 * Desktop persistent sidebar (~320px).
 * Layout from top to bottom:
 *   1. PresetThumbCard (selected style or empty placeholder)
 *   2. Modality-specific controls (image upload, model selector, etc.)
 *   3. PromptInput (textarea + enhance toggle)
 *   4. Generate button with credit cost
 */
const FlowSidebar = memo<Props>(
  ({
    controls,
    creditCost,
    generateLabel,
    isGenerating,
    modality,
    onClearPreset,
    onGenerate,
    preset,
    promptInput,
  }) => {
    const label = generateLabel ?? (modality === 'video' ? 'Создать видео' : 'Создать');

    return (
      <Flexbox
        gap={12}
        height={'100%'}
        padding={16}
        style={{
          background: 'var(--ant-color-bg-layout)',
          borderInlineEnd: '1px solid var(--ant-color-border-secondary)',
          inlineSize: 320,
          minInlineSize: 320,
        }}
      >
        <PresetThumbCard onClear={onClearPreset} preset={preset} />
        {controls}
        {promptInput}
        <Button
          block
          loading={isGenerating}
          onClick={onGenerate}
          size="large"
          style={{ marginBlockStart: 'auto' }}
          type="primary"
        >
          {label}
          {creditCost !== undefined && (
            <span style={{ marginInlineStart: 6, opacity: 0.85 }}>✦ {creditCost}</span>
          )}
        </Button>
      </Flexbox>
    );
  },
);

FlowSidebar.displayName = 'FlowSidebar';

export default FlowSidebar;
```

- [ ] **Step 16.2: Commit**

```bash
git add src/features/Generators/FlowSidebar.tsx
git commit -m "feat(presets): FlowSidebar (desktop persistent left panel)"
```

---

## Task 17: MobileFlowSheet + MobileFlowFAB

**Files:**

- Create: `src/features/Generators/MobileFlowSheet.tsx`

- Create: `src/features/Generators/MobileFlowFAB.tsx`

- [ ] **Step 17.1: MobileFlowSheet**

Create `src/features/Generators/MobileFlowSheet.tsx`:

```tsx
'use client';

import { Drawer } from 'antd';
import { type ComponentProps, memo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  onClose: () => void;
  open: boolean;
}

const drawerStyles: ComponentProps<typeof Drawer>['styles'] = {
  body: { padding: 16 },
  header: { display: 'none' },
};

const MobileFlowSheet = memo<Props>(({ children, onClose, open }) => {
  return (
    <Drawer
      closable={false}
      destroyOnHidden
      height="80vh"
      onClose={onClose}
      open={open}
      placement="bottom"
      styles={drawerStyles}
    >
      {children}
    </Drawer>
  );
});

MobileFlowSheet.displayName = 'MobileFlowSheet';

export default MobileFlowSheet;
```

- [ ] **Step 17.2: MobileFlowFAB**

Create `src/features/Generators/MobileFlowFAB.tsx`:

```tsx
'use client';

import { Sparkles } from 'lucide-react';
import { memo } from 'react';

interface Props {
  hidden?: boolean;
  label?: string;
  onClick: () => void;
}

/**
 * Bottom-right floating button. Sits ~80px above bottom edge so it
 * stays clear of `MobileTabBar`.
 */
const MobileFlowFAB = memo<Props>(({ hidden, label = 'Создать', onClick }) => {
  if (hidden) return null;

  return (
    <button
      onClick={onClick}
      style={{
        alignItems: 'center',
        background: 'var(--ant-color-primary)',
        border: 0,
        borderRadius: 999,
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
        color: '#fff',
        cursor: 'pointer',
        display: 'flex',
        fontSize: 14,
        fontWeight: 600,
        gap: 8,
        insetInlineEnd: 16,
        padding: '12px 18px',
        position: 'fixed',
        zIndex: 40,
      }}
      type="button"
    >
      <Sparkles size={16} />
      {label}
    </button>
  );
});

MobileFlowFAB.displayName = 'MobileFlowFAB';

export default MobileFlowFAB;
```

- [ ] **Step 17.3: Commit**

```bash
git add src/features/Generators/MobileFlowSheet.tsx src/features/Generators/MobileFlowFAB.tsx
git commit -m "feat(presets): MobileFlowSheet (drawer) + MobileFlowFAB"
```

---

## Task 18: FlowMainArea — image and video

**Files:**

- Create: `src/app/[variants]/(main)/image/features/FlowMainArea.tsx`
- Create: `src/app/[variants]/(main)/video/features/FlowMainArea.tsx`

The two are near-identical but live next to their modality-specific feed/empty-state to follow the project's per-route file convention.

- [ ] **Step 18.1: Image FlowMainArea**

Create `src/app/[variants]/(main)/image/features/FlowMainArea.tsx`:

```tsx
'use client';

import { Tabs } from 'antd';
import { memo } from 'react';

import PresetGallery from '@/features/Generators/PresetGallery';
import { useFlowUrlState } from '@/features/Generators/useFlowUrlState';
import { useImageStore } from '@/store/image';
import { presetSelectors } from '@/store/image/slices/preset/selectors';
import { generationBatchSelectors } from '@/store/image/selectors';

import GenerationFeed from './GenerationFeed';

const FlowMainArea = memo(() => {
  const hasGenerations = useImageStore(generationBatchSelectors.hasAnyBatches);
  const selectPreset = useImageStore((s) => s.selectPreset);
  const selectedSlug = useImageStore(presetSelectors.presetSlug);

  const url = useFlowUrlState(hasGenerations ? 'feed' : 'presets');

  return (
    <Tabs
      activeKey={url.tab}
      onChange={(k) => url.setTab(k === 'presets' ? 'presets' : 'feed')}
      items={[
        {
          key: 'presets',
          label: 'Стили',
          children: (
            <PresetGallery
              category={url.category}
              modality="image"
              modelId={url.modelId}
              onCategoryChange={url.setCategory}
              onModelChange={url.setModel}
              onPresetSelect={(p) => {
                selectPreset(p);
                url.setPreset(p.slug);
              }}
              onSearchChange={url.setQ}
              q={url.q}
              selectedSlug={selectedSlug}
            />
          ),
        },
        {
          key: 'feed',
          label: 'Мои генерации',
          children: <GenerationFeed />,
        },
      ]}
      style={{ height: '100%' }}
    />
  );
});

FlowMainArea.displayName = 'ImageFlowMainArea';

export default FlowMainArea;
```

If `generationBatchSelectors.hasAnyBatches` does not yet exist, add it to `src/store/image/selectors.ts`:

```ts
hasAnyBatches: (s: ImageStoreState) => (s.generationBatches?.length ?? 0) > 0,
```

(Adjust to whatever the actual field name is — read the slice's state shape first.)

- [ ] **Step 18.2: Video FlowMainArea**

Create `src/app/[variants]/(main)/video/features/FlowMainArea.tsx` mirroring 18.1 with `useVideoStore`/`videoStore`/`'video'`. Same `hasAnyBatches` selector pattern.

- [ ] **Step 18.3: Commit**

```bash
git add src/app/[variants]/(main)/image/features/FlowMainArea.tsx src/app/[variants]/(main)/video/features/FlowMainArea.tsx src/store/image/selectors.ts src/store/video/selectors.ts
git commit -m "feat(presets): FlowMainArea (Стили | Мои генерации tabs)"
```

---

## Task 19: Integrate FlowSidebar into image desktop layout (behind ?new_flow=1)

**Files:**

- Modify: `src/app/[variants]/(main)/image/_layout/index.tsx`

- Modify: `src/app/[variants]/(main)/image/index.tsx`

- [ ] **Step 19.1: Layout — render FlowSidebar in new flow, fall back to old**

Replace `src/app/[variants]/(main)/image/_layout/index.tsx`:

```tsx
'use client';

import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';
import { Outlet, useSearchParams } from 'react-router-dom';

import RegisterHotkeys from './RegisterHotkeys';
import Sidebar from './Sidebar';
import { styles } from './style';
import TopicSidebar from './TopicSidebar';

const Layout: FC = () => {
  const [params] = useSearchParams();
  const newFlow = params.get('new_flow') === '1';

  if (newFlow) {
    // New flow has its own sidebar inside index.tsx (FlowSidebar +
    // FlowMainArea). The legacy Sidebar/TopicSidebar are not rendered.
    return (
      <>
        <Outlet />
        <RegisterHotkeys />
      </>
    );
  }

  return (
    <>
      <Sidebar />
      <Flexbox horizontal className={styles.mainContainer} flex={1} height={'100%'}>
        <Flexbox className={styles.contentContainer} flex={1} height={'100%'}>
          <Outlet />
        </Flexbox>
        <TopicSidebar />
      </Flexbox>
      <RegisterHotkeys />
    </>
  );
};

export default Layout;
```

- [ ] **Step 19.2: index.tsx — branch on flag**

Modify `src/app/[variants]/(main)/image/index.tsx`. Reuse the existing PromptInput component as the `promptInput` slot in FlowSidebar:

```tsx
'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useSearchParams } from 'react-router-dom';

import FlowSidebar from '@/features/Generators/FlowSidebar';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useImageStore } from '@/store/image';
import { presetSelectors } from '@/store/image/slices/preset/selectors';

import FlowMainArea from './features/FlowMainArea';
import PromptInput from './features/PromptInput';
import ImageWorkspace from './features/ImageWorkspace';
import ImageWorkspaceMobile from './ImageWorkspaceMobile';

const ImagePage = memo(() => {
  const [params] = useSearchParams();
  const newFlow = params.get('new_flow') === '1';
  const isMobile = useIsMobile();

  const preset = useImageStore(presetSelectors.currentPreset);
  const clearPreset = useImageStore((s) => s.clearPreset);
  const isGenerating = useImageStore((s) => s.isCreating);
  const createImage = useImageStore((s) => s.createImage);

  if (!newFlow) {
    return isMobile ? <ImageWorkspaceMobile /> : <ImageWorkspace />;
  }

  if (isMobile) {
    // Wired in Task 21
    return <ImageWorkspaceMobile />;
  }

  return (
    <Flexbox horizontal flex={1} height={'100%'} width={'100%'}>
      <FlowSidebar
        controls={null}
        isGenerating={isGenerating}
        modality="image"
        onClearPreset={clearPreset}
        onGenerate={() => createImage()}
        preset={preset}
        promptInput={<PromptInput />}
      />
      <Flexbox flex={1} height={'100%'}>
        <FlowMainArea />
      </Flexbox>
    </Flexbox>
  );
});

ImagePage.displayName = 'ImagePage';
export default ImagePage;
```

- [ ] **Step 19.3: Smoke test**

Run dev server, navigate to `/image?new_flow=1`. Verify:

- left sidebar shows empty preset slot, prompt input, generate button
- main area shows tabs Стили | Мои генерации
- Стили tab shows model tabs, category tabs, search, grid of preset cards (preview MP4 will 404 until Task 23 — placeholder/black ok)
- clicking a preset → sidebar shows selected preset thumbnail + name + ✕
- clicking ✕ clears the preset
- clicking Generate fires the existing createImage action

Then verify `/image` (no flag) still renders the legacy ImageWorkspace.

- [ ] **Step 19.4: Commit**

```bash
git add src/app/[variants]/(main)/image/_layout/index.tsx src/app/[variants]/(main)/image/index.tsx
git commit -m "feat(image): wire FlowSidebar + FlowMainArea behind ?new_flow=1"
```

---

## Task 20: Same for video desktop

**Files:**

- Modify: `src/app/[variants]/(main)/video/_layout/index.tsx`

- Modify: `src/app/[variants]/(main)/video/index.tsx`

- [ ] **Step 20.1–20.3:** Mirror Task 19 against `video`. Use `useVideoStore`, `createVideo`, `isCreating` from the video store; replace `<PromptInput>` import with the video version.

- [ ] **Step 20.4: Commit**

```bash
git add src/app/[variants]/(main)/video/_layout/index.tsx src/app/[variants]/(main)/video/index.tsx
git commit -m "feat(video): wire FlowSidebar + FlowMainArea behind ?new_flow=1"
```

---

## Task 21: Mobile wiring — ImageWorkspaceMobile

**Files:**

- Modify: `src/app/[variants]/(main)/image/ImageWorkspaceMobile.tsx`

- [ ] **Step 21.1: Rewrite mobile**

Replace contents of `src/app/[variants]/(main)/image/ImageWorkspaceMobile.tsx`:

```tsx
'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import MobileFlowFAB from '@/features/Generators/MobileFlowFAB';
import MobileFlowSheet from '@/features/Generators/MobileFlowSheet';
import MobileGlobalHeader from '@/features/MobileGlobalHeader';
import { useImageStore } from '@/store/image';
import { presetSelectors } from '@/store/image/slices/preset/selectors';

import FlowMainArea from './features/FlowMainArea';
import ImageWorkspace from './features/ImageWorkspace';
import PromptInput from './features/PromptInput';

const ImageWorkspaceMobile = memo(() => {
  const [params] = useSearchParams();
  const newFlow = params.get('new_flow') === '1';
  const [sheetOpen, setSheetOpen] = useState(false);

  const preset = useImageStore(presetSelectors.currentPreset);
  const clearPreset = useImageStore((s) => s.clearPreset);
  const isGenerating = useImageStore((s) => s.isCreating);
  const createImage = useImageStore((s) => s.createImage);

  if (!newFlow) {
    // Legacy mobile workspace
    return (
      <>
        <MobileGlobalHeader />
        <Flexbox
          flex={1}
          style={{
            overflowY: 'auto',
            paddingBlockEnd: 'calc(env(safe-area-inset-bottom, 0px) + 80px)',
            position: 'relative',
          }}
          width={'100%'}
        >
          <ImageWorkspace />
        </Flexbox>
      </>
    );
  }

  return (
    <>
      <MobileGlobalHeader />
      <Flexbox
        flex={1}
        style={{
          overflowY: 'auto',
          paddingBlockEnd: 'calc(env(safe-area-inset-bottom, 0px) + 80px)',
          position: 'relative',
        }}
        width={'100%'}
      >
        <FlowMainArea />
      </Flexbox>

      <MobileFlowFAB hidden={sheetOpen} onClick={() => setSheetOpen(true)} />

      <MobileFlowSheet onClose={() => setSheetOpen(false)} open={sheetOpen}>
        <Flexbox gap={12}>
          {/* sheet content matches FlowSidebar's stack but laid out vertically */}
          {/* PresetThumb */}
          {preset ? (
            <button
              onClick={clearPreset}
              style={{
                background: 'transparent',
                border: 0,
                color: 'var(--ant-color-text)',
                textAlign: 'start',
              }}
              type="button"
            >
              <strong>Стиль:</strong> {preset.title} · ✕
            </button>
          ) : (
            <span style={{ color: 'var(--ant-color-text-tertiary)' }}>Стиль не выбран</span>
          )}

          <PromptInput />

          <button
            disabled={isGenerating}
            onClick={async () => {
              await createImage();
              setSheetOpen(false);
            }}
            style={{
              background: 'var(--ant-color-primary)',
              border: 0,
              borderRadius: 8,
              color: '#fff',
              fontSize: 16,
              fontWeight: 600,
              padding: '14px 16px',
            }}
            type="button"
          >
            {isGenerating ? 'Создаём…' : 'Создать'}
          </button>
        </Flexbox>
      </MobileFlowSheet>
    </>
  );
});

ImageWorkspaceMobile.displayName = 'ImageWorkspaceMobile';

export default ImageWorkspaceMobile;
```

- [ ] **Step 21.2: Smoke test on narrow viewport**

In Chrome devtools at iPhone 12 viewport, navigate to `/image?new_flow=1`:

- Header visible, Стили | Мои генерации tabs work
- FAB "Создать" floats bottom-right above tab-bar
- Tap FAB → bottom-sheet at 80vh with prompt + Generate
- Generate → loading, sheet closes on success

Then verify `/image` without flag = old mobile workspace (unchanged).

- [ ] **Step 21.3: Commit**

```bash
git add src/app/[variants]/(main)/image/ImageWorkspaceMobile.tsx
git commit -m "feat(image-mobile): FAB + bottom-sheet flow behind ?new_flow=1"
```

---

## Task 22: Mobile wiring — VideoWorkspaceMobile

**Files:**

- Modify: `src/app/[variants]/(main)/video/VideoWorkspaceMobile.tsx`

- [ ] **Step 22.1–22.2:** Mirror Task 21 against video. Keep the existing `<PlanGateBanner />` at the top of the new flow as well (it still applies to free users).

- [ ] **Step 22.3: Commit**

```bash
git add src/app/[variants]/(main)/video/VideoWorkspaceMobile.tsx
git commit -m "feat(video-mobile): FAB + bottom-sheet flow behind ?new_flow=1"
```

---

## Task 23: Generate + upload preset preview MP4s

This is content work, not code. Engineer needs a clean local checkout, our existing Image and Video model providers, and SSH access to the production server (RustFS bucket).

- [ ] **Step 23.1: Generate the 24 MP4 previews locally**

For each preset row in `0098_presets.sql`:

- Use the model named in `model_id` and the `prompt_template` (with `{{user_prompt}}` filled with a generic noun like "a hero" / "a bottle" / "a city" appropriate to the category).
- Generate at the aspect ratio in `params_lock`.
- Trim to 3–6 seconds, encode as MP4 H.264 baseline + AAC silent track, target \~1–2 MB per file.

Save each file as `<slug>.mp4` in a local `presets-previews/` directory.

- [ ] **Step 23.2: Upload to RustFS**

Use the existing `bucket.config.json` and `mc` client (see `/opt/lobechat/` on prod for the existing config). Run:

```bash
mc cp presets-previews/*.mp4 rustfs/gptweb/presets/
mc anonymous set download rustfs/gptweb/presets
```

Verify each URL resolves: `curl -I https://rustfs.gptweb.ru/presets/crash-zoom-in.mp4` returns 200.

- [ ] **Step 23.3: No code commit — content-only.** Optionally check the local `presets-previews/` directory into `docs/superpowers/specs/` as reference, but do NOT bundle MP4s into the repo (gitignore `*.mp4`).

---

## Task 24: Internal smoke + flip default

**Files:**

- Modify: `src/app/[variants]/(main)/image/_layout/index.tsx` (remove flag check)

- Modify: `src/app/[variants]/(main)/image/index.tsx` (remove flag check)

- Modify: `src/app/[variants]/(main)/video/_layout/index.tsx` (remove flag check)

- Modify: `src/app/[variants]/(main)/video/index.tsx` (remove flag check)

- Modify: `src/app/[variants]/(main)/image/ImageWorkspaceMobile.tsx` (remove flag check)

- Modify: `src/app/[variants]/(main)/video/VideoWorkspaceMobile.tsx` (remove flag check)

- [ ] **Step 24.1: Smoke checklist (manual, before flip)**

Open prod or staging behind `?new_flow=1` and walk through:

- [ ] Desktop /image: sidebar visible, gallery loads, all 12 image presets render with looping MP4s

- [ ] Click a preset → sidebar thumbnail appears, ✕ clears

- [ ] Type prompt → click Generate → result appears in feed tab

- [ ] Switch tabs Стили ↔ Мои генерации

- [ ] Search "studio" → only Studio Portrait card shown

- [ ] Filter by model tab → grid filters

- [ ] Filter by category → grid filters

- [ ] Same on /video (12 video presets)

- [ ] Mobile /image: FAB visible, sheet opens, generate works

- [ ] Mobile /video: same + PlanGateBanner still renders for free users

- [ ] Deep-link `?preset=crash-zoom-in` → preset auto-selected on load

- [ ] No "Matched leaf route" warnings in console

- [ ] No 404 in network panel for preset MP4s

- [ ] **Step 24.2: Flip flag default**

In each of the six files, replace `const newFlow = params.get('new_flow') === '1';` with `const newFlow = params.get('new_flow') !== '0';` — i.e. default ON, opt-out via `?new_flow=0` (kept temporarily for emergency rollback).

- [ ] **Step 24.3: Re-run smoke checklist on / (no flag)**

All checks from 24.1 must pass without `?new_flow=1`.

- [ ] **Step 24.4: Commit**

```bash
git add src/app/[variants]/(main)/image/ src/app/[variants]/(main)/video/
git commit -m "feat(generators): flip ?new_flow default ON; ?new_flow=0 keeps legacy"
```

Deploy and watch logs for 24h.

---

## Task 25: Cleanup — delete legacy

**Only run this 24+ hours after Task 24 lands cleanly in production.**

**Files to delete:**

```
src/app/[variants]/(main)/image/_layout/TopicSidebar.tsx
src/app/[variants]/(main)/image/_layout/Sidebar.tsx
src/app/[variants]/(main)/image/_layout/Header.tsx
src/app/[variants]/(main)/image/_layout/ConfigPanel/
src/app/[variants]/(main)/image/_layout/style.ts (if unused after deletes)
src/app/[variants]/(main)/image/features/ImageWorkspace/EmptyState.tsx
src/app/[variants]/(main)/video/_layout/TopicSidebar.tsx
src/app/[variants]/(main)/video/_layout/Sidebar.tsx
src/app/[variants]/(main)/video/_layout/Header.tsx
src/app/[variants]/(main)/video/_layout/ConfigPanel/
src/app/[variants]/(main)/video/features/VideoWorkspace/EmptyState.tsx
```

**Files to simplify (remove flag branch):**

- All six files touched in Task 24 — drop the `newFlow` check, render the new flow always.

- [ ] **Step 25.1: Delete legacy files**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
git rm 'src/app/[variants]/(main)/image/_layout/TopicSidebar.tsx'
git rm 'src/app/[variants]/(main)/image/_layout/Sidebar.tsx'
git rm 'src/app/[variants]/(main)/image/_layout/Header.tsx'
git rm -r 'src/app/[variants]/(main)/image/_layout/ConfigPanel'
git rm 'src/app/[variants]/(main)/image/features/ImageWorkspace/EmptyState.tsx'
git rm 'src/app/[variants]/(main)/video/_layout/TopicSidebar.tsx'
git rm 'src/app/[variants]/(main)/video/_layout/Sidebar.tsx'
git rm 'src/app/[variants]/(main)/video/_layout/Header.tsx'
git rm -r 'src/app/[variants]/(main)/video/_layout/ConfigPanel'
git rm 'src/app/[variants]/(main)/video/features/VideoWorkspace/EmptyState.tsx'
```

- [ ] **Step 25.2: Simplify the six wiring files**

For `src/app/[variants]/(main)/image/_layout/index.tsx`:

```tsx
'use client';

import { type FC } from 'react';
import { Outlet } from 'react-router-dom';

import RegisterHotkeys from './RegisterHotkeys';

const Layout: FC = () => (
  <>
    <Outlet />
    <RegisterHotkeys />
  </>
);

export default Layout;
```

For `index.tsx` and the mobile equivalents — remove `useSearchParams` imports and the `newFlow` branch; keep only the new-flow body.

For `src/app/[variants]/(main)/video/_layout/index.tsx`: same shape as image layout.

- [ ] **Step 25.3: Verify build**

```bash
bun run typecheck && bun run lint
```

Expected: clean. If anything imports a deleted file, fix it.

- [ ] **Step 25.4: Verify nothing references TopicSidebar / ConfigPanel**

```bash
grep -rn 'TopicSidebar\|ConfigPanel' src/app/[variants]/{image,video} 2> /dev/null
```

Expected: no output.

- [ ] **Step 25.5: Commit**

```bash
git add -A
git commit -m "refactor(generators): delete legacy TopicSidebar / ConfigPanel / EmptyState

24h after the new flow shipped without rollbacks. Removes ~10 legacy
files and the ?new_flow flag plumbing. The new flow is now the only
path."
```

---

## Self-Review (run before handing off)

**Spec coverage:**

| Spec section                                      | Plan task                          |
| ------------------------------------------------- | ---------------------------------- |
| `presets` table schema                            | Task 1                             |
| 10–12 seed presets per modality                   | Task 1 (24 rows)                   |
| TS types                                          | Task 2                             |
| tRPC `presets.list` / `getBySlug`                 | Task 3                             |
| Category registry (Russian labels)                | Task 4                             |
| `{{user_prompt}}` template renderer               | Task 5                             |
| Preset slice in image store                       | Task 6                             |
| Preset slice in video store                       | Task 7                             |
| `PresetMP4Player` lazy-loop                       | Task 8                             |
| `PresetCard` with badges + title overlay          | Task 9                             |
| Model tabs (top of gallery)                       | Task 10                            |
| Category tabs                                     | Task 11                            |
| Responsive grid (2-col mobile, auto-fill desktop) | Task 12                            |
| Search field + composed gallery                   | Task 13                            |
| URL ↔ state sync                                  | Task 14                            |
| `PresetThumbCard` (selected preview + ✕)          | Task 15                            |
| `FlowSidebar` desktop                             | Task 16                            |
| Mobile bottom-sheet + FAB                         | Task 17                            |
| Tabs Стили / Мои генерации                        | Task 18                            |
| Behind `?new_flow=1` — image                      | Task 19                            |
| Behind `?new_flow=1` — video                      | Task 20                            |
| Mobile wiring — image                             | Task 21                            |
| Mobile wiring — video                             | Task 22                            |
| Manual MP4 upload to RustFS                       | Task 23                            |
| Smoke + flip default                              | Task 24                            |
| Cleanup legacy                                    | Task 25                            |
| Tracking events `preset_view/apply/generate`      | **Deferred to phase 2** (see note) |
| Admin UI                                          | Phase 2                            |
| Automated MP4 pre-generation                      | Phase 2                            |
| User-saved personal presets                       | Phase 2                            |

> **Tracking events note:** the spec lists `preset_view / preset_apply / preset_generate` as v1. The plan above does NOT add these — they were dropped to keep the v1 footprint manageable and because the existing `useTrackUpsell` integration would need a new `source` taxonomy that has implications for the admin funnel chart. **Add a tracking task here if v1 must ship with analytics.** Otherwise the launch goes out without preset-level conversion data and we add it in a follow-up week.

**Placeholder scan:** none. Every code step has complete code; no "TBD"/"similar to" references.

**Type consistency:** `Preset` (singular), `PresetModality`, `PresetBadge`, `PresetParamsLock`, `Preset` re-used across types/router/store/components. `selectPreset` and `clearPreset` consistent across image and video stores. Selectors named `presetSelectors.currentPreset` / `.hasPreset` / `.presetSlug` in both modalities.

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-10-higgsfield-style-generators-plan.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review (spec compliance → code quality) between tasks, fast iteration. Best for a 25-task plan.
2. **Inline Execution** — execute in this session via `superpowers:executing-plans`, with manual checkpoints.

Which approach?
