// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';

import { presetsRouter } from '../presets';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(),
}));

// ---------------------------------------------------------------------------
// In-memory seed data — mirrors a representative subset of the 24 rows
// inserted by migration 0098_presets.sql. Tests against this stub verify
// router shape and filtering wiring; integration with real DB is exercised
// at runtime via the serverDatabase middleware.
// ---------------------------------------------------------------------------
type SeedRow = {
  active: boolean;
  badges: string[];
  category: string;
  createdAt: Date;
  description: string | null;
  id: number;
  modality: string;
  modelId: string;
  paramsLock: Record<string, unknown>;
  previewUrl: string;
  promptTemplate: string;
  slug: string;
  sortOrder: number;
  title: string;
  updatedAt: Date;
};

const now = new Date('2026-05-10T00:00:00Z');

const SEEDS: SeedRow[] = [
  {
    active: true,
    badges: ['top_choice'],
    category: 'camera',
    createdAt: now,
    description: 'Aggressive zoom into subject',
    id: 1,
    modality: 'video',
    modelId: 'bytedance/seedance-2.0-fast/text-to-video',
    paramsLock: { duration_sec: 5 },
    previewUrl: 'https://rustfs.gptweb.ru/presets/crash-zoom-in.mp4',
    promptTemplate: 'crash zoom in on {subject}',
    slug: 'crash-zoom-in',
    sortOrder: 10,
    title: 'Crash Zoom In',
    updatedAt: now,
  },
  {
    active: true,
    badges: ['trending'],
    category: 'camera',
    createdAt: now,
    description: 'Pull back to reveal Earth',
    id: 2,
    modality: 'video',
    modelId: 'bytedance/seedance-2.0-fast/text-to-video',
    paramsLock: { duration_sec: 5 },
    previewUrl: 'https://rustfs.gptweb.ru/presets/earth-zoom-out.mp4',
    promptTemplate: 'earth zoom out from {subject}',
    slug: 'earth-zoom-out',
    sortOrder: 20,
    title: 'Earth Zoom Out',
    updatedAt: now,
  },
  {
    active: true,
    badges: [],
    category: 'camera',
    createdAt: now,
    description: 'Frozen-time orbit',
    id: 3,
    modality: 'video',
    modelId: 'kwaivgi/kling-v3.0-pro/text-to-video',
    paramsLock: { duration_sec: 5 },
    previewUrl: 'https://rustfs.gptweb.ru/presets/bullet-time.mp4',
    promptTemplate: 'bullet time around {subject}',
    slug: 'bullet-time',
    sortOrder: 30,
    title: 'Bullet Time',
    updatedAt: now,
  },
  {
    active: true,
    badges: [],
    category: 'effects',
    createdAt: now,
    description: 'Building blows up',
    id: 4,
    modality: 'video',
    modelId: 'bytedance/seedance-2.0-fast/text-to-video',
    paramsLock: { duration_sec: 5 },
    previewUrl: 'https://rustfs.gptweb.ru/presets/building-explosion.mp4',
    promptTemplate: '{subject} building explodes',
    slug: 'building-explosion',
    sortOrder: 40,
    title: 'Building Explosion',
    updatedAt: now,
  },
  {
    active: true,
    badges: ['top_choice'],
    category: 'portrait',
    createdAt: now,
    description: 'Studio-lit portrait',
    id: 100,
    modality: 'image',
    modelId: 'flux-pro',
    paramsLock: { aspect_ratio: '3:4' },
    previewUrl: 'https://rustfs.gptweb.ru/presets/portrait-studio.jpg',
    promptTemplate: 'studio portrait of {subject}',
    slug: 'portrait-studio',
    sortOrder: 10,
    title: 'Studio Portrait',
    updatedAt: now,
  },
];

// ---------------------------------------------------------------------------
// Filter state: each test sets these, the stub honours them when resolving
// the awaited query chain. We mimic the router's own filter logic so the
// stub stays a thin pass-through for "did the router pass the right intent".
//
// In addition, the stub captures the raw argument the router hands to
// `.where(...)`. That object is Drizzle's condition tree; we don't introspect
// it deeply, but having the reference proves the router actually composed and
// forwarded a where-clause. Tests assert against `lastWhereArg` so a
// regression like dropping `if (input.modelId) conditions.push(...)` in the
// router would visibly change the captured tree and fail the assertion.
// ---------------------------------------------------------------------------
interface PendingFilter {
  category?: string;
  limit?: number;
  modality?: string;
  modelId?: string;
  q?: string;
  slug?: string;
}

let pendingFilter: PendingFilter = {};
let lastWhereArg: unknown;

const applyFilter = (rows: SeedRow[]): SeedRow[] => {
  let out = rows.filter((r) => r.active);
  if (pendingFilter.modality) out = out.filter((r) => r.modality === pendingFilter.modality);
  if (pendingFilter.modelId) out = out.filter((r) => r.modelId === pendingFilter.modelId);
  if (pendingFilter.category) out = out.filter((r) => r.category === pendingFilter.category);
  if (pendingFilter.q) {
    const needle = pendingFilter.q.toLowerCase();
    out = out.filter((r) => r.title.toLowerCase().includes(needle));
  }
  if (pendingFilter.slug) out = out.filter((r) => r.slug === pendingFilter.slug);
  out.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  if (pendingFilter.limit) out = out.slice(0, pendingFilter.limit);
  return out;
};

// A query proxy that resolves to filtered rows when awaited. We dodge a
// hand-built `then` (eslint unicorn/no-thenable) by extending Promise.
class QueryProxy<T> extends Promise<T[]> {
  static get [Symbol.species]() {
    return Promise;
  }

  // The chained drizzle methods all return `this` so `await chain` yields
  // the resolved value from the underlying executor. We capture the raw
  // condition tree that the router built so tests can assert it was passed.
  where(cond: unknown) {
    lastWhereArg = cond;
    return this;
  }

  orderBy(..._args: unknown[]) {
    return this;
  }

  limit(n: number) {
    pendingFilter.limit = n;
    return this;
  }
}

const buildQueryProxy = () => new QueryProxy<SeedRow>((resolve) => resolve(applyFilter(SEEDS)));

const buildDbStub = () => ({
  select: vi.fn(() => ({
    from: vi.fn(() => buildQueryProxy()),
  })),
});

beforeEach(() => {
  pendingFilter = {};
  lastWhereArg = undefined;
  vi.mocked(getServerDB).mockResolvedValue(buildDbStub() as any);
});

// Walk the captured Drizzle condition tree and collect every primitive value
// found in any `value` field. Drizzle's `eq(col, val)` produces a node whose
// shape includes the literal we passed in — searching for that literal proves
// the router actually built and forwarded the corresponding condition.
const collectValues = (node: unknown, out: unknown[] = []): unknown[] => {
  if (node === null || node === undefined) return out;
  if (typeof node !== 'object') {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectValues(child, out);
    return out;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    // Skip column metadata (table/column refs) — we only care about literals.
    if (key === 'table' || key === 'column' || key === 'schema') continue;
    collectValues(value, out);
  }
  return out;
};

describe('presetsRouter', () => {
  it('list returns active presets filtered by modality', async () => {
    pendingFilter = { modality: 'video' };
    const caller = presetsRouter.createCaller({} as any);
    const result = await caller.list({ modality: 'video' });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((p) => p.modality === 'video')).toBe(true);
    expect(result.every((p) => typeof p.previewUrl === 'string')).toBe(true);
  });

  it('list filters by modelId', async () => {
    pendingFilter = {
      modality: 'video',
      modelId: 'bytedance/seedance-2.0-fast/text-to-video',
    };
    const caller = presetsRouter.createCaller({} as any);
    const result = await caller.list({
      modality: 'video',
      modelId: 'bytedance/seedance-2.0-fast/text-to-video',
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((p) => p.modelId === 'bytedance/seedance-2.0-fast/text-to-video')).toBe(
      true,
    );

    // Regression guard: the captured where-clause must reference the modelId
    // we passed in. If the router silently drops
    // `if (input.modelId) conditions.push(eq(presets.modelId, ...))`,
    // this literal will no longer appear in the condition tree.
    expect(lastWhereArg).toBeDefined();
    const literals = collectValues(lastWhereArg);
    expect(literals).toContain('bytedance/seedance-2.0-fast/text-to-video');
  });

  it('list filters by category', async () => {
    pendingFilter = { category: 'camera', modality: 'video' };
    const caller = presetsRouter.createCaller({} as any);
    const result = await caller.list({ modality: 'video', category: 'camera' });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((p) => p.category === 'camera')).toBe(true);

    // Regression guard: same shape as the modelId case — the category literal
    // must surface in the captured condition tree.
    expect(lastWhereArg).toBeDefined();
    const literals = collectValues(lastWhereArg);
    expect(literals).toContain('camera');
  });

  it('list filters by q (case-insensitive title match)', async () => {
    pendingFilter = { modality: 'video', q: 'zoom' };
    const caller = presetsRouter.createCaller({} as any);
    const result = await caller.list({ modality: 'video', q: 'zoom' });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((p) => p.title.toLowerCase().includes('zoom'))).toBe(true);

    // Regression guard: the ilike pattern (`%zoom%`) must show up in the tree.
    expect(lastWhereArg).toBeDefined();
    const literals = collectValues(lastWhereArg);
    expect(literals).toContain('%zoom%');
  });

  it('list omits the modelId clause when modelId is not provided', async () => {
    pendingFilter = { modality: 'video' };
    const caller = presetsRouter.createCaller({} as any);
    await caller.list({ modality: 'video' });

    // The where-clause is still composed (active + modality), but the
    // modelId literal must NOT appear since we didn't pass it.
    expect(lastWhereArg).toBeDefined();
    const literals = collectValues(lastWhereArg);
    expect(literals).not.toContain('bytedance/seedance-2.0-fast/text-to-video');
    expect(literals).not.toContain('kwaivgi/kling-v3.0-pro/text-to-video');
  });

  it('getBySlug returns one preset', async () => {
    pendingFilter = { slug: 'crash-zoom-in' };
    const caller = presetsRouter.createCaller({} as any);
    const p = await caller.getBySlug({ slug: 'crash-zoom-in' });
    expect(p?.slug).toBe('crash-zoom-in');
    expect(p?.modality).toBe('video');
  });

  it('getBySlug returns null on missing slug', async () => {
    pendingFilter = { slug: 'does-not-exist' };
    const caller = presetsRouter.createCaller({} as any);
    const p = await caller.getBySlug({ slug: 'does-not-exist' });
    expect(p).toBeNull();
  });
});
