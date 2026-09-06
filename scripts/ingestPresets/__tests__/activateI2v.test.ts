import { describe, expect, it } from 'vitest';

import { formatPlan, planActivation, type QueuedRow, rowToSourceItem } from '../activateI2v';
import { I2V_RECOMMENDED_MODEL } from '../derive';

const PROMPT =
  'Use @image1 as the subject. Cinematic slow push-in on the person, soft rim light, ' +
  'shallow depth of field, gentle wind in the hair, realistic skin and fabric motion';

const row = (overrides: Partial<QueuedRow> = {}): QueuedRow => ({
  author_name: 'Jane',
  author_url: 'https://x.com/jane_doe',
  external_id: '2094046000000000001',
  id: '101',
  modality: 'video',
  params_lock: { aspect_ratio: '16:9' },
  popularity: 320,
  preview_url: 'https://ask.gptweb.ru/s3/lobe/presets/trend-2094046000000000001.mp4',
  prompt_template: PROMPT,
  recommended_model_id: 'bytedance/seedance-2.0-fast/text-to-video',
  slug: 'trend-2094046000000000001',
  title: 'Портрет: кино',
  ...overrides,
});

describe('rowToSourceItem', () => {
  it('rebuilds the source item the filters need from the stored columns', () => {
    expect(rowToSourceItem(row())).toEqual({
      aspectRatio: '16:9',
      author: { name: 'Jane', username: 'jane_doe' },
      id: '2094046000000000001',
      image: undefined,
      prompt: PROMPT,
      stats: { likes: 320 },
      title: 'Портрет: кино',
      videoUrl: 'https://ask.gptweb.ru/s3/lobe/presets/trend-2094046000000000001.mp4',
    });
  });

  it('leaves the handle undefined when the author url is not an X profile', () => {
    expect(rowToSourceItem(row({ author_url: null })).author?.username).toBeUndefined();
    expect(
      rowToSourceItem(row({ author_url: 'https://evil.example/jane' })).author?.username,
    ).toBeUndefined();
  });
});

describe('planActivation', () => {
  it('activates a row that passes every current rule, on the paired t2v model', () => {
    const plan = planActivation([row()]);
    expect(plan.keep).toEqual([]);
    expect(plan.activate).toEqual([
      {
        id: '101',
        modality: 'video',
        recommendedModelId: I2V_RECOMMENDED_MODEL,
        slug: 'trend-2094046000000000001',
      },
    ]);
  });

  it('keeps rows that fail another rule, with the reasons', () => {
    const plan = planActivation([
      row({ external_id: '2094046000000000001', id: '1', params_lock: {}, slug: 'no-aspect' }),
      row({ external_id: '2094046000000000002', id: '2', popularity: 4, slug: 'few-likes' }),
      row({ author_url: null, external_id: '2094046000000000003', id: '3', slug: 'no-author' }),
    ]);
    expect(plan.activate).toEqual([]);
    expect(plan.keep).toEqual([
      { id: '1', reasons: ['aspect-ratio'], slug: 'no-aspect' },
      { id: '2', reasons: ['low-likes'], slug: 'few-likes' },
      { id: '3', reasons: ['no-attribution'], slug: 'no-author' },
    ]);
  });

  it('never activates a row whose prompt now trips the safety stop-list', () => {
    const plan = planActivation([row({ prompt_template: `${PROMPT} holding a rifle` })]);
    expect(plan.activate).toEqual([]);
    expect(plan.keep[0].reasons).toEqual(['safety:rifle']);
  });

  it('applies the per-author cap so one author cannot flood the gallery', () => {
    const plan = planActivation([
      row({ external_id: '2094046000000000001', id: '1', slug: 'a' }),
      row({ external_id: '2094046000000000002', id: '2', slug: 'b' }),
      row({ external_id: '2094046000000000003', id: '3', slug: 'c' }),
    ]);
    expect(plan.activate.map((r) => r.slug)).toEqual(['a', 'b']);
    expect(plan.keep).toEqual([{ id: '3', reasons: ['author-cap'], slug: 'c' }]);
  });

  it('ignores image (i2i) rows entirely — no image-side gate exists', () => {
    const plan = planActivation([
      row({
        modality: 'image',
        preview_url: 'https://ask.gptweb.ru/s3/lobe/presets/trend-1.webp',
        slug: 'img',
      }),
    ]);
    expect(plan).toEqual({ activate: [], keep: [] });
  });
});

describe('formatPlan', () => {
  it('marks a dry run explicitly', () => {
    const text = formatPlan(planActivation([row()]), false);
    expect(text).toContain('would activate: 1');
    expect(text).toContain('DRY RUN');
  });

  it('reports an applied run without the dry-run footer', () => {
    const text = formatPlan(planActivation([row()]), true);
    expect(text).toContain('activated: 1');
    expect(text).not.toContain('DRY RUN');
  });
});
