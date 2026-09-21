import { describe, expect, it } from 'vitest';

import { normalizeVideoParams } from '../normalizeVideoParams';

describe('normalizeVideoParams', () => {
  it.each([
    'google/veo3.1-lite/text-to-video',
    'google/veo3.1-lite/image-to-video',
    'google/veo3.1-fast/text-to-video',
    'google/veo3.1/text-to-video',
  ])('%s: 1080p with a non-8s duration drops to 720p, keeps duration', (model) => {
    const r = normalizeVideoParams(model, { duration: 6, prompt: 'x', resolution: '1080p' });
    expect(r.params).toEqual({ duration: 6, prompt: 'x', resolution: '720p' });
    expect(r.changed).toHaveLength(1);
  });

  it('leaves 1080p + 8s alone', () => {
    const r = normalizeVideoParams('google/veo3.1-lite/text-to-video', {
      duration: 8,
      resolution: '1080p',
    });
    expect(r.params).toEqual({ duration: 8, resolution: '1080p' });
    expect(r.changed).toEqual([]);
  });

  it('leaves 720p and non-Veo models alone', () => {
    expect(
      normalizeVideoParams('google/veo3.1-lite/text-to-video', { duration: 6, resolution: '720p' })
        .changed,
    ).toEqual([]);
    expect(
      normalizeVideoParams('bytedance/seedance-2.0-fast/text-to-video', {
        duration: 6,
        resolution: '1080p',
      }).changed,
    ).toEqual([]);
  });

  it('does not touch params when duration is not provided', () => {
    const r = normalizeVideoParams('google/veo3.1/text-to-video', { resolution: '1080p' });
    expect(r.changed).toEqual([]);
  });
});
