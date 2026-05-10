import { and, eq, ilike } from 'drizzle-orm';
import { z } from 'zod';

import { presets } from '@/database/schemas';
import { publicProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import type { Preset, PresetBadge, PresetParamsLock } from '@/types/preset';

const modalityEnum = z.enum(['image', 'video']);

const procedure = publicProcedure.use(serverDatabase);

const rowToPreset = (r: typeof presets.$inferSelect): Preset => {
  // Defensive guard: if a future bad write puts a non-object into
  // params_lock (null, array, scalar), `Object.entries(...)` in
  // selectPreset would throw. Force the shape to a plain object.
  const rawLock = r.paramsLock as unknown;
  const safeLock: PresetParamsLock =
    typeof rawLock === 'object' && rawLock !== null && !Array.isArray(rawLock)
      ? (rawLock as PresetParamsLock)
      : {};

  return {
    badges: (r.badges as PresetBadge[]) ?? [],
    category: r.category,
    description: r.description,
    id: r.id,
    modality: r.modality as Preset['modality'],
    modelId: r.modelId,
    paramsLock: safeLock,
    previewUrl: r.previewUrl,
    promptTemplate: r.promptTemplate,
    slug: r.slug,
    sortOrder: r.sortOrder,
    title: r.title,
  };
};

export const presetsRouter = router({
  getBySlug: procedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ ctx, input }): Promise<Preset | null> => {
      const rows = await ctx.serverDB
        .select()
        .from(presets)
        .where(and(eq(presets.slug, input.slug), eq(presets.active, true)))
        .limit(1);
      return rows[0] ? rowToPreset(rows[0]) : null;
    }),

  list: procedure
    .input(
      z.object({
        category: z.string().optional(),
        modality: modalityEnum,
        modelId: z.string().optional(),
        q: z.string().min(1).max(80).optional(),
      }),
    )
    .query(async ({ ctx, input }): Promise<Preset[]> => {
      const conditions = [eq(presets.active, true), eq(presets.modality, input.modality)];
      if (input.modelId) conditions.push(eq(presets.modelId, input.modelId));
      if (input.category) conditions.push(eq(presets.category, input.category));
      if (input.q) conditions.push(ilike(presets.title, `%${input.q}%`));

      const rows = await ctx.serverDB
        .select()
        .from(presets)
        .where(and(...conditions))
        .orderBy(presets.sortOrder, presets.id);
      return rows.map(rowToPreset);
    }),
});
