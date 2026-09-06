import { describe, expect, it } from 'vitest';

import {
  asciiRatio,
  detectRequiresImage,
  evaluateBatch,
  evaluateItem,
  findUnsafeTerm,
  MIN_LIKES,
  MIN_PROMPT_LENGTH,
  resolveAspectRatio,
} from '../filters';
import type { SourceItem } from '../types';

const LONG_PROMPT =
  'Cinematic wide shot of a lighthouse on a rocky coast at golden hour, anamorphic lens, ' +
  'slow dolly in, volumetric light, realistic ocean spray and drifting fog over the water';

const item = (overrides: Partial<SourceItem> = {}): SourceItem => ({
  aspectRatio: '16:9',
  author: { name: 'Jane', username: 'jane_doe' },
  id: '1234567890',
  prompt: LONG_PROMPT,
  stats: { likes: 500 },
  videoUrl: 'https://images.meigen.ai/videos/1234567890/video.mp4',
  ...overrides,
});

const evaluate = (source: SourceItem, known = new Set<string>()) =>
  evaluateItem(source, { authorPublishCount: new Map(), known, modality: 'video' });

describe('findUnsafeTerm', () => {
  it('matches stop-list terms case-insensitively', () => {
    expect(findUnsafeTerm('A NUDE figure in the rain')).toBe('nude');
    expect(findUnsafeTerm('holding a Rifle')).toBe('rifle');
    expect(findUnsafeTerm('a Disney-style castle')).toBe('disney');
  });

  it('anchors on word boundaries so common words do not false-positive', () => {
    // "begun" contains "gun", "method" contains "meth", "blooded" contains "blood"
    expect(findUnsafeTerm('the shoot had begun at dawn')).toBeNull();
    expect(findUnsafeTerm('a methodical camera method')).toBeNull();
    expect(findUnsafeTerm('a cold-blooded reptile basking')).toBeNull();
  });

  it('handles terms with non-word characters', () => {
    expect(findUnsafeTerm('an ak-47 on the table')).toBe('ak-47');
    expect(findUnsafeTerm("a mcdonald's counter")).toBe('mcdonald');
  });

  it('returns null for a clean prompt', () => {
    expect(findUnsafeTerm(LONG_PROMPT)).toBeNull();
  });
});

describe('asciiRatio', () => {
  it('is 1 for pure ASCII', () => {
    expect(asciiRatio('plain english prompt')).toBe(1);
  });

  it('only samples the leading window', () => {
    const prompt = `${'a'.repeat(200)}${'日'.repeat(200)}`;
    expect(asciiRatio(prompt)).toBe(1);
  });

  it('drops below the threshold for CJK-heavy prompts', () => {
    expect(asciiRatio('日本語のプロンプトです')).toBeLessThan(0.9);
  });

  it('is 0 for an empty prompt', () => {
    expect(asciiRatio('')).toBe(0);
  });
});

describe('detectRequiresImage', () => {
  it.each([
    '@image1 walks towards the camera',
    'place @[image1] into the scene',
    'animate the uploaded image of a cat',
    'use the uploaded photo as the base',
    'create a separate poster for each uploaded photo',
    'keep the reference face consistent',
  ])('flags %s', (prompt) => {
    expect(detectRequiresImage(prompt)).toBe(true);
  });

  it('does not flag a plain text-to-video prompt', () => {
    expect(detectRequiresImage(LONG_PROMPT)).toBe(false);
  });
});

describe('resolveAspectRatio', () => {
  it('passes through exact whitelist entries', () => {
    expect(resolveAspectRatio(item({ aspectRatio: '9:16' }))).toBe('9:16');
    expect(resolveAspectRatio(item({ aspectRatio: '1:1' }))).toBe('1:1');
  });

  it('snaps the un-normalised ratios the source really emits', () => {
    // 427:240 = 1.779, 159:91 = 1.747, 26:15 = 1.733, 7:4 = 1.75 — all 16:9 footage
    expect(resolveAspectRatio(item({ aspectRatio: '427:240' }))).toBe('16:9');
    expect(resolveAspectRatio(item({ aspectRatio: '159:91' }))).toBe('16:9');
    expect(resolveAspectRatio(item({ aspectRatio: '7:4' }))).toBe('16:9');
  });

  it('falls back to pixel dimensions when aspectRatio is absent (images endpoint)', () => {
    expect(
      resolveAspectRatio(item({ aspectRatio: undefined, imageHeight: 1200, imageWidth: 900 })),
    ).toBe('3:4');
  });

  it('rejects ratios outside tolerance', () => {
    // 2:3 portrait — 11% away from the nearest supported 3:4
    expect(
      resolveAspectRatio(item({ aspectRatio: undefined, imageHeight: 1200, imageWidth: 800 })),
    ).toBeNull();
    expect(resolveAspectRatio(item({ aspectRatio: '21:9' }))).toBeNull();
  });

  it('returns null when nothing is resolvable', () => {
    expect(resolveAspectRatio(item({ aspectRatio: undefined }))).toBeNull();
  });
});

describe('evaluateItem', () => {
  it('publishes an item that passes every rule', () => {
    const result = evaluate(item());
    expect(result).toMatchObject({ aspectRatio: '16:9', reasons: [], verdict: 'publish' });
  });

  it('skips unsafe items outright so nothing is stored', () => {
    const result = evaluate(item({ prompt: `${LONG_PROMPT} with a shotgun` }));
    expect(result.verdict).toBe('skip');
    expect(result.reasons[0]).toBe('safety:shotgun');
  });

  it('checks the title as well as the prompt', () => {
    const result = evaluate(item({ title: 'Pikachu the pokemon' }));
    expect(result.verdict).toBe('skip');
  });

  it('skips duplicates before doing any other work', () => {
    const result = evaluate(item(), new Set(['1234567890']));
    expect(result).toMatchObject({ reasons: ['duplicate'], verdict: 'skip' });
  });

  it('queues (never drops) items that fail a quality rule', () => {
    expect(evaluate(item({ prompt: 'too short' }))).toMatchObject({
      reasons: expect.arrayContaining(['prompt-too-short']),
      verdict: 'queue',
    });
    expect(evaluate(item({ stats: { likes: MIN_LIKES - 1 } }))).toMatchObject({
      reasons: ['low-likes'],
      verdict: 'queue',
    });
    expect(evaluate(item({ aspectRatio: '21:9' }))).toMatchObject({
      reasons: ['aspect-ratio'],
      verdict: 'queue',
    });
    expect(evaluate(item({ author: {} }))).toMatchObject({
      reasons: ['no-attribution'],
      verdict: 'queue',
    });
    expect(evaluate(item({ videoUrl: undefined }))).toMatchObject({
      reasons: ['no-media-url'],
      verdict: 'queue',
    });
  });

  it('publishes an i2v item that passes the other rules, flagged requiresImage (Ф5)', () => {
    const result = evaluate(item({ prompt: `${LONG_PROMPT}. Use @image1 as the subject.` }));
    expect(result).toMatchObject({ reasons: [], requiresImage: true, verdict: 'publish' });
  });

  it('keeps image (i2i) reference-image prompts queued — no image-side gate yet', () => {
    const [{ evaluation }] = evaluateBatch(
      [
        item({
          image: 'https://images.meigen.ai/tweets/1/0.jpg',
          prompt: `${LONG_PROMPT}. Use @image1 as the subject.`,
          videoUrl: undefined,
        }),
      ],
      { known: new Set(), modality: 'image' },
    );
    expect(evaluation).toMatchObject({
      reasons: ['requires-image-i2i-pending'],
      requiresImage: true,
      verdict: 'queue',
    });
  });

  it('still queues an i2v item that fails a quality rule', () => {
    const result = evaluate(
      item({ prompt: `${LONG_PROMPT}. Use @image1 as the subject.`, stats: { likes: 3 } }),
    );
    expect(result).toMatchObject({ reasons: ['low-likes'], requiresImage: true, verdict: 'queue' });
  });

  it('reports every failed rule, not just the first', () => {
    const result = evaluate(item({ aspectRatio: '21:9', prompt: 'short', stats: { likes: 1 } }));
    expect(result.reasons).toEqual(
      expect.arrayContaining(['prompt-too-short', 'aspect-ratio', 'low-likes']),
    );
  });

  it('accepts a prompt exactly at the length threshold', () => {
    const exact = 'a'.repeat(MIN_PROMPT_LENGTH);
    expect(evaluate(item({ prompt: exact })).reasons).not.toContain('prompt-too-short');
  });
});

describe('evaluateBatch', () => {
  // ids must look like real X snowflakes — attribution depends on it
  const byAuthor = (username: string, suffix: string) =>
    item({ author: { name: username, username }, id: `209404600000000000${suffix}` });

  it('publishes at most two items per author per run', () => {
    const results = evaluateBatch(
      [byAuthor('same', '1'), byAuthor('same', '2'), byAuthor('same', '3'), byAuthor('other', '4')],
      { known: new Set(), modality: 'video' },
    );

    expect(results.map((r) => r.evaluation.verdict)).toEqual([
      'publish',
      'publish',
      'queue',
      'publish',
    ]);
    expect(results[2].evaluation.reasons).toContain('author-cap');
  });

  it('does not spend author budget on items that were queued anyway', () => {
    const results = evaluateBatch(
      [
        item({ author: { username: 'same' }, id: '2094046000000000001', stats: { likes: 0 } }),
        byAuthor('same', '2'),
        byAuthor('same', '3'),
      ],
      { known: new Set(), modality: 'video' },
    );

    expect(results.map((r) => r.evaluation.verdict)).toEqual(['queue', 'publish', 'publish']);
  });

  it('does not mutate the caller’s known set', () => {
    const known = new Set<string>();
    evaluateBatch([item()], { known, modality: 'video' });
    expect(known.size).toBe(0);
  });

  it('de-duplicates repeated ids inside one batch', () => {
    const results = evaluateBatch([item(), item()], { known: new Set(), modality: 'video' });
    expect(results.map((r) => r.evaluation.verdict)).toEqual(['publish', 'skip']);
  });

  it('uses the image media url when the modality is image', () => {
    const [{ evaluation }] = evaluateBatch(
      [item({ image: 'https://images.meigen.ai/tweets/1/0.jpg', videoUrl: undefined })],
      { known: new Set(), modality: 'image' },
    );
    expect(evaluation.reasons).not.toContain('no-media-url');
  });
});

describe('attribution rule', () => {
  it('queues an item whose id is not a real source post', () => {
    // /api/images serves the source's own community uploads under these ids
    const result = evaluate(item({ id: 'community_34e69cb0-4906-44d1-b52e-a4ff78d5714f' }));
    expect(result.verdict).toBe('queue');
    expect(result.reasons).toContain('no-attribution');
  });
});
