import { describe, expect, it } from 'vitest';

import { imageAspectFor, imageRouteFor, videoRouteFor } from '../eligibility';

const plans = new Set(['basic', 'pro', 'pro_max', 'free']);

describe('imageRouteFor', () => {
  it('routes a single Nano Banana text-to-image with a supported ratio', () => {
    expect(imageRouteFor('google/nano-banana-2/text-to-image', { aspectRatio: '16:9' }, 1)).toEqual(
      {
        aspect: '16:9',
      },
    );
  });

  it('defaults to 1:1 when no size is given', () => {
    expect(imageRouteFor('google/nano-banana-2/text-to-image', {}, 1)).toEqual({ aspect: '1:1' });
  });

  it('derives the ratio from width/height', () => {
    expect(imageAspectFor({ height: 1080, width: 1920 })).toBe('16:9');
    expect(imageAspectFor({ height: 1920, width: 1080 })).toBe('9:16');
    expect(imageAspectFor({ height: 1024, width: 1024 })).toBe('1:1');
    expect(imageAspectFor({ height: 768, width: 1024 })).toBeNull();
  });

  it('refuses other models, multi-image batches, edits and odd ratios', () => {
    expect(imageRouteFor('wavespeed-ai/flux-schnell', {}, 1)).toBeNull();
    expect(imageRouteFor('google/nano-banana-2/text-to-image', {}, 2)).toBeNull();
    expect(
      imageRouteFor('google/nano-banana-2/text-to-image', { imageUrls: ['https://x/a.png'] }, 1),
    ).toBeNull();
    expect(
      imageRouteFor('google/nano-banana-2/text-to-image', { aspectRatio: '4:3' }, 1),
    ).toBeNull();
  });
});

describe('videoRouteFor', () => {
  it('routes Veo Fast 720p 16:9 8 s text-to-video on an allowed plan', () => {
    expect(
      videoRouteFor(
        'google/veo3.1-fast/text-to-video',
        { aspectRatio: '16:9', duration: 8, resolution: '720p' },
        'pro',
        plans,
      ),
    ).toEqual({ aspect: '16:9', seconds: 8 });
  });

  it('carries the start frame for image-to-video and accepts Lite (Fast ≥ Lite)', () => {
    expect(
      videoRouteFor(
        'google/veo3.1-lite/image-to-video',
        { aspectRatio: '9:16', duration: 4, imageUrl: 'https://s3/x.jpg' },
        'basic',
        plans,
      ),
    ).toEqual({ aspect: '9:16', image: 'https://s3/x.jpg', seconds: 4 });
  });

  it('never downgrades: quality Veo, 1080p, odd durations, references, other plans', () => {
    const p = { aspectRatio: '16:9', duration: 8, resolution: '720p' };
    expect(videoRouteFor('google/veo3.1/text-to-video', p, 'pro', plans)).toBeNull();
    expect(
      videoRouteFor(
        'google/veo3.1-fast/text-to-video',
        { ...p, resolution: '1080p' },
        'pro',
        plans,
      ),
    ).toBeNull();
    expect(
      videoRouteFor('google/veo3.1-fast/text-to-video', { ...p, duration: 5 }, 'pro', plans),
    ).toBeNull();
    expect(
      videoRouteFor('google/veo3.1-fast/text-to-video', { ...p, aspectRatio: '1:1' }, 'pro', plans),
    ).toBeNull();
    expect(
      videoRouteFor('google/veo3.1-fast/text-to-video', { ...p, imageUrls: ['a'] }, 'pro', plans),
    ).toBeNull();
    expect(
      videoRouteFor('google/veo3.1-fast/text-to-video', { ...p, endImageUrl: 'a' }, 'pro', plans),
    ).toBeNull();
    expect(videoRouteFor('bytedance/seedance-2.0/text-to-video', p, 'pro', plans)).toBeNull();
    expect(
      videoRouteFor('google/veo3.1-fast/text-to-video', p, 'pro', new Set(['basic'])),
    ).toBeNull();
  });
});
