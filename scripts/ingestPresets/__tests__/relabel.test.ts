import { describe, expect, it, vi } from 'vitest';

import type { ClassifyResult } from '../classify';
import { BLOCKED_LICENSE, LICENSE } from '../derive';
import { formatRelabelTable, planRelabel, runRelabel } from '../relabel';
import type { Queryable, StoredPreset } from '../upsert';

const row = (overrides: Partial<StoredPreset> = {}): StoredPreset => ({
  active: true,
  category: 'trends',
  description: null,
  id: 1,
  license: LICENSE,
  modality: 'video',
  params_lock: { aspect_ratio: '16:9' },
  prompt_template: 'A cinematic burger commercial with slow-motion sesame seeds',
  requires_image: false,
  slug: 'trend-1',
  title: 'Портрет: макро',
  ...overrides,
});

const ok = (overrides: Partial<Extract<ClassifyResult, { ok: true }>> = {}): ClassifyResult => ({
  category: 'ad',
  ok: true,
  rawCategory: 'ad',
  requiresImage: false,
  summary: 'Реклама бургера',
  title: 'Реклама бургера в стиле кино',
  unsafe: false,
  ...overrides,
});

/** A `pg`-shaped mock: SELECT returns `rows`, every other statement is recorded. */
const mockDb = (rows: StoredPreset[]) => {
  const query = vi.fn(async (sql: string, _params?: unknown[]) => {
    if (/^\s*SELECT/i.test(sql)) return { rowCount: rows.length, rows };
    return { rowCount: 1, rows: [] };
  });
  return { client: { query } as unknown as Queryable, query };
};

const mockClassifier = (...results: ClassifyResult[]) => {
  const classify = vi.fn(async () => results.shift() ?? ({ ok: false, reason: 'exhausted' } as const));
  return { classify, stats: { calls: 0 } } as unknown as Parameters<typeof runRelabel>[1] & {
    classify: typeof classify;
  };
};

const writes = (query: ReturnType<typeof vi.fn>) =>
  query.mock.calls.filter(([sql]) => !/^\s*SELECT/i.test(sql as string));

describe('planRelabel', () => {
  it('rewrites labels and keeps active for a plain t2v row', () => {
    const change = planRelabel(row(), ok())!;
    expect(change.after).toEqual({
      active: true,
      category: 'ad',
      description: 'Реклама бургера',
      license: LICENSE,
      requiresImage: false,
      title: 'Реклама бургера в стиле кино',
    });
    expect(change.changed).toBe(true);
    expect(change.flags).toEqual([]);
  });

  it('parks an active row that becomes i2v', () => {
    const change = planRelabel(row(), ok({ requiresImage: true }))!;
    expect(change.after.requiresImage).toBe(true);
    expect(change.after.active).toBe(false);
    expect(change.flags).toContain('i2v→off');
  });

  it('does not touch active when the row was already i2v', () => {
    const change = planRelabel(row({ requires_image: true }), ok({ requiresImage: true }))!;
    expect(change.after.active).toBe(true);
    expect(change.flags).toEqual([]);
  });

  it('never clears a stored requires_image, even if the LLM says false', () => {
    const change = planRelabel(row({ active: false, requires_image: true }), ok({ requiresImage: false }))!;
    expect(change.after.requiresImage).toBe(true);
  });

  it('picks up the regex too (stored OR regex OR llm)', () => {
    const change = planRelabel(
      row({ prompt_template: 'Animate the uploaded image into a slow orbit' }),
      ok({ requiresImage: false }),
    )!;
    expect(change.after.requiresImage).toBe(true);
    expect(change.after.active).toBe(false);
  });

  it('parks unsafe rows, stamps license=blocked and flags them', () => {
    const change = planRelabel(row(), ok({ unsafe: true }))!;
    expect(change.after.active).toBe(false);
    expect(change.after.license).toBe(BLOCKED_LICENSE);
    expect(change.flags).toEqual(['unsafe', 'unsafe→off', 'blocked+']);
    expect(change.changed).toBe(true);
  });

  it('marks a change when the verdict is the only thing that differs', () => {
    const already = row({
      active: false,
      category: 'ad',
      description: 'Реклама бургера',
      title: 'Реклама бургера в стиле кино',
    });
    const change = planRelabel(already, ok({ unsafe: true }))!;
    expect(change.after.license).toBe(BLOCKED_LICENSE);
    expect(change.changed).toBe(true);
    expect(change.flags).toEqual(['unsafe', 'blocked+']);
  });

  it('keeps a blocked row blocked and parked even when the model now says safe', () => {
    const blocked = row({ active: false, license: BLOCKED_LICENSE });
    const change = planRelabel(blocked, ok({ unsafe: false }))!;
    expect(change.after.license).toBe(BLOCKED_LICENSE);
    expect(change.after.active).toBe(false);
    expect(change.flags).toEqual(['blocked']);

    // A blocked row that somehow got re-activated by hand is parked again.
    const revived = planRelabel(row({ active: true, license: BLOCKED_LICENSE }), ok())!;
    expect(revived.after.active).toBe(false);
    expect(revived.flags).toEqual(['blocked', 'blocked→off']);
  });

  it('keeps the stored category when the LLM slug is unknown', () => {
    const change = planRelabel(row({ category: 'cinematic' }), ok({ category: null, rawCategory: 'food' }))!;
    expect(change.after.category).toBe('cinematic');
    expect(change.flags).toEqual(['cat?food']);
  });

  it('returns null for a failed classification', () => {
    expect(planRelabel(row(), { ok: false, reason: 'transport' })).toBeNull();
  });
});

describe('runRelabel', () => {
  it('dry-run classifies but issues no writes', async () => {
    const { client, query } = mockDb([row(), row({ id: 2, slug: 'trend-2' })]);
    const classifier = mockClassifier(ok(), ok({ requiresImage: true }));

    const outcome = await runRelabel(client, classifier, { apply: false, limit: 10 });

    expect(outcome.scanned).toBe(2);
    expect(outcome.changes).toHaveLength(2);
    expect(outcome.written).toBe(0);
    expect(writes(query)).toHaveLength(0);
    expect(classifier.classify).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]![1]).toEqual([10, null]);
  });

  it('passes --since through to the SELECT', async () => {
    const { client, query } = mockDb([]);
    await runRelabel(client, mockClassifier(), { apply: false, limit: 5, since: '2026-09-06T12:00:00Z' });
    expect(query.mock.calls[0]![0]).toMatch(/ingested_at >= \$2/);
    expect(query.mock.calls[0]![1]).toEqual([5, '2026-09-06T12:00:00Z']);
  });

  it('--apply writes one UPDATE per changed row', async () => {
    const { client, query } = mockDb([row(), row({ id: 2, slug: 'trend-2' })]);
    const classifier = mockClassifier(ok(), ok({ requiresImage: true }));

    const outcome = await runRelabel(client, classifier, { apply: true, limit: 10 });

    expect(outcome.written).toBe(2);
    const updates = writes(query);
    expect(updates).toHaveLength(2);
    expect(updates[0]![0]).toMatch(/UPDATE presets/);
    expect(updates[1]![1]).toEqual([
      'Реклама бургера в стиле кино',
      'Реклама бургера',
      'ad',
      true,
      false,
      LICENSE,
      2,
    ]);
  });

  it('--apply writes license=blocked for an unsafe verdict', async () => {
    const { client, query } = mockDb([row()]);
    await runRelabel(client, mockClassifier(ok({ unsafe: true })), { apply: true, limit: 5 });
    const [sql, params] = writes(query)[0]!;
    expect(sql).toMatch(/license = \$6/);
    expect(params).toEqual([
      'Реклама бургера в стиле кино',
      'Реклама бургера',
      'ad',
      false,
      false,
      BLOCKED_LICENSE,
      1,
    ]);
  });

  it('skips writes for rows whose labels did not change', async () => {
    const already = row({
      category: 'ad',
      description: 'Реклама бургера',
      title: 'Реклама бургера в стиле кино',
    });
    const { client, query } = mockDb([already]);
    const outcome = await runRelabel(client, mockClassifier(ok()), { apply: true, limit: 5 });
    expect(outcome.changes[0]!.changed).toBe(false);
    expect(outcome.written).toBe(0);
    expect(writes(query)).toHaveLength(0);
  });

  it('leaves failed rows untouched and stops at the cap', async () => {
    const { client, query } = mockDb([row(), row({ id: 2, slug: 'trend-2' }), row({ id: 3, slug: 'trend-3' })]);
    const classifier = mockClassifier({ ok: false, reason: 'schema: x' }, { ok: false, reason: 'cap' }, ok());

    const outcome = await runRelabel(client, classifier, { apply: true, limit: 10 });

    expect(outcome.failed).toEqual([
      { reason: 'schema: x', slug: 'trend-1' },
      { reason: 'cap', slug: 'trend-2' },
    ]);
    expect(classifier.classify).toHaveBeenCalledTimes(2);
    expect(writes(query)).toHaveLength(0);
  });

  it('makes no LLM call when there is nothing to relabel', async () => {
    const { client } = mockDb([]);
    const classifier = mockClassifier(ok());
    const outcome = await runRelabel(client, classifier, { apply: true, limit: 10 });
    expect(outcome.scanned).toBe(0);
    expect(classifier.classify).not.toHaveBeenCalled();
  });

  it('renders a before→after table', () => {
    const table = formatRelabelTable({
      changes: [
        planRelabel(row(), ok({ requiresImage: true }))!,
        planRelabel(row({ id: 2, slug: 'trend-2' }), ok({ unsafe: true }))!,
      ],
      failed: [{ reason: 'cap', slug: 'trend-9' }],
      scanned: 3,
      written: 0,
    });
    expect(table).toContain('«Портрет: макро» → «Реклама бургера в стиле кино»');
    expect(table).toContain('trends → ad');
    expect(table).toContain('-→Y');
    expect(table).toContain('Y→-');
    expect(table).toContain('i2v→off');
    expect(table).toContain('| blk   | flags');
    // i2v row: not blocked; unsafe row: blocked column flips and the flag shows
    expect(table).toMatch(/trend-1 .*\| -→- {3}\| i2v→off/);
    expect(table).toMatch(/trend-2 .*\| -→Y {3}\| unsafe,unsafe→off,blocked\+/);
    expect(table).toContain('trend-9                    | FAILED: cap');
  });
});
