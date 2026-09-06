import { and, count, desc, eq, ilike, isNotNull, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';

import { presets } from '@/database/schemas';
import { publicProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import type {
  Preset,
  PresetBadge,
  PresetFacets,
  PresetListItem,
  PresetParamsLock,
  PresetSort,
} from '@/types/preset';

const modalityEnum = z.enum(['image', 'video']);
const sortEnum = z.enum(['curated', 'popular', 'new']);

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;

const procedure = publicProcedure.use(serverDatabase);

/**
 * Columns returned by `list`. Mirrors `PresetListItem` — note the deliberate
 * absence of `prompt_template` (see the type's doc comment).
 */
const listColumns = {
  authorAvatar: presets.authorAvatar,
  authorName: presets.authorName,
  authorUrl: presets.authorUrl,
  badges: presets.badges,
  category: presets.category,
  description: presets.description,
  externalId: presets.externalId,
  id: presets.id,
  ingestedAt: presets.ingestedAt,
  license: presets.license,
  modality: presets.modality,
  paramsLock: presets.paramsLock,
  popularity: presets.popularity,
  posterUrl: presets.posterUrl,
  previewUrl: presets.previewUrl,
  recommendedModelId: presets.recommendedModelId,
  requiresImage: presets.requiresImage,
  slug: presets.slug,
  sortOrder: presets.sortOrder,
  sourcePlatform: presets.sourcePlatform,
  sourceUrl: presets.sourceUrl,
  title: presets.title,
} as const;

type ListRow = { [K in keyof typeof listColumns]: (typeof presets.$inferSelect)[K] };

const rowToListItem = (r: ListRow): PresetListItem => {
  // Defensive guard: if a future bad write puts a non-object into
  // params_lock (null, array, scalar), `Object.entries(...)` in
  // selectPreset would throw. Force the shape to a plain object.
  const rawLock = r.paramsLock as unknown;
  const safeLock: PresetParamsLock =
    typeof rawLock === 'object' && rawLock !== null && !Array.isArray(rawLock)
      ? (rawLock as PresetParamsLock)
      : {};

  return {
    authorAvatar: r.authorAvatar,
    authorName: r.authorName,
    authorUrl: r.authorUrl,
    badges: (r.badges as PresetBadge[]) ?? [],
    category: r.category,
    description: r.description,
    externalId: r.externalId,
    id: r.id,
    ingestedAt: r.ingestedAt ? r.ingestedAt.toISOString() : null,
    license: r.license,
    modality: r.modality as PresetListItem['modality'],
    paramsLock: safeLock,
    popularity: r.popularity,
    posterUrl: r.posterUrl,
    previewUrl: r.previewUrl,
    recommendedModelId: r.recommendedModelId,
    requiresImage: r.requiresImage ?? false,
    slug: r.slug,
    sortOrder: r.sortOrder,
    sourcePlatform: r.sourcePlatform,
    sourceUrl: r.sourceUrl,
    title: r.title,
  };
};

const rowToPreset = (r: typeof presets.$inferSelect): Preset => ({
  ...rowToListItem(r),
  promptTemplate: r.promptTemplate,
});

// ---------------------------------------------------------------------------
// Keyset pagination
// ---------------------------------------------------------------------------
// The cursor is an opaque base64 blob carrying `{ k, id }`, where `k` is the
// numeric value of the current sort's primary key expression. Offset pagination
// would drift as the ingest cron inserts rows mid-scroll; a keyset stays stable.
// `k` is always a number so the encoding stays trivial:
//   curated → sort_order · popular → popularity (NULL → -1)
//   new     → ingested_at as epoch-milliseconds (NULL → 0)

interface Cursor {
  id: number;
  k: number;
}

const encodeCursor = (c: Cursor): string =>
  Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');

const decodeCursor = (raw: string): Cursor | null => {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { id, k } = parsed as Record<string, unknown>;
    if (typeof id !== 'number' || typeof k !== 'number') return null;
    return { id, k };
  } catch {
    // A hand-edited / stale cursor must not 500 the gallery — fall back to
    // page one instead.
    return null;
  }
};

/**
 * `date_trunc` to milliseconds keeps the ORDER BY expression and the cursor
 * value (a JS Date, ms precision) exactly comparable. Without it a timestamp
 * with microseconds would compare "greater" than its own truncated cursor and
 * the row would be served twice.
 */
const ingestedAtMs = sql`(extract(epoch from date_trunc('milliseconds', coalesce(${presets.ingestedAt}, 'epoch'::timestamptz))) * 1000)::bigint`;
const popularityRank = sql`coalesce(${presets.popularity}, -1)`;

const sortKeyOf = (sort: PresetSort, row: ListRow): number => {
  switch (sort) {
    case 'popular': {
      return row.popularity ?? -1;
    }
    case 'new': {
      return row.ingestedAt ? row.ingestedAt.getTime() : 0;
    }
    default: {
      return row.sortOrder;
    }
  }
};

const orderByOf = (sort: PresetSort): SQL[] => {
  switch (sort) {
    case 'popular': {
      return [sql`${popularityRank} desc`, sql`${presets.id} asc`];
    }
    case 'new': {
      return [sql`${ingestedAtMs} desc`, sql`${presets.id} asc`];
    }
    default: {
      return [sql`${presets.sortOrder} asc`, sql`${presets.id} asc`];
    }
  }
};

const keysetOf = (sort: PresetSort, c: Cursor): SQL => {
  switch (sort) {
    // DESC on the key, ASC on the tie-break id — mixed directions rule out
    // postgres row comparison, so spell the predicate out.
    case 'popular': {
      return sql`(${popularityRank} < ${c.k} or (${popularityRank} = ${c.k} and ${presets.id} > ${c.id}))`;
    }
    case 'new': {
      return sql`(${ingestedAtMs} < ${c.k} or (${ingestedAtMs} = ${c.k} and ${presets.id} > ${c.id}))`;
    }
    default: {
      return sql`(${presets.sortOrder}, ${presets.id}) > (${c.k}, ${c.id})`;
    }
  }
};

export const presetsRouter = router({
  /**
   * Distinct categories and models that actually exist in the catalogue for a
   * modality, with row counts. The gallery's tab strips are built from this
   * instead of a hardcoded list, so a category introduced by the ingest cron
   * is reachable in the UI the moment the first row lands. It also replaces
   * the second full `list` fetch `ModelTabs` used to make just to derive tabs.
   */
  facets: procedure
    .input(z.object({ modality: modalityEnum }))
    .query(async ({ ctx, input }): Promise<PresetFacets> => {
      const where = and(eq(presets.active, true), eq(presets.modality, input.modality));

      const [categoryRows, modelRows] = await Promise.all([
        ctx.serverDB
          .select({ category: presets.category, count: count() })
          .from(presets)
          .where(where)
          .groupBy(presets.category)
          .orderBy(desc(count()), presets.category),
        ctx.serverDB
          .select({ count: count(), modelId: presets.recommendedModelId })
          .from(presets)
          .where(and(where, isNotNull(presets.recommendedModelId)))
          .groupBy(presets.recommendedModelId)
          .orderBy(desc(count()), presets.recommendedModelId),
      ]);

      return {
        categories: categoryRows.map((r) => ({ category: r.category, count: Number(r.count) })),
        models: modelRows
          // `isNotNull` already filtered these out; the guard is only here to
          // satisfy the nullable column type.
          .filter((r): r is typeof r & { modelId: string } => r.modelId !== null)
          .map((r) => ({ count: Number(r.count), modelId: r.modelId })),
      };
    }),

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
        /** Opaque keyset cursor from a previous page's `nextCursor`. */
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
        modality: modalityEnum,
        q: z.string().min(1).max(80).optional(),
        recommendedModelId: z.string().optional(),
        sort: sortEnum.default('curated'),
      }),
    )
    .query(
      async ({ ctx, input }): Promise<{ items: PresetListItem[]; nextCursor: string | null }> => {
        const conditions = [eq(presets.active, true), eq(presets.modality, input.modality)];
        if (input.recommendedModelId)
          conditions.push(eq(presets.recommendedModelId, input.recommendedModelId));
        if (input.category) conditions.push(eq(presets.category, input.category));
        if (input.q) conditions.push(ilike(presets.title, `%${input.q}%`));

        const cursor = input.cursor ? decodeCursor(input.cursor) : null;
        if (cursor) conditions.push(keysetOf(input.sort, cursor));

        // Over-fetch by one: the extra row only tells us whether another page
        // exists, it is never returned.
        const rows = (await ctx.serverDB
          .select(listColumns)
          .from(presets)
          .where(and(...conditions))
          .orderBy(...orderByOf(input.sort))
          .limit(input.limit + 1)) as ListRow[];

        const hasMore = rows.length > input.limit;
        const page = hasMore ? rows.slice(0, input.limit) : rows;
        const last = page.at(-1);

        return {
          items: page.map((r) => rowToListItem(r)),
          nextCursor:
            hasMore && last ? encodeCursor({ id: last.id, k: sortKeyOf(input.sort, last) }) : null,
        };
      },
    ),
});
