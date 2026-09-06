import { describe, expect, it } from 'vitest';

import { resolveVideoEndpoint } from '../../../packages/model-runtime/src/providers/wavespeed/utils/pairedEndpoint';
import {
  DEFAULT_MODEL,
  deriveAttribution,
  deriveCategory,
  deriveTitle,
  FALLBACK_CATEGORY,
  I2V_RECOMMENDED_MODEL,
  isSourcePostId,
  MAX_TITLE_LENGTH,
  posterKeyFor,
  previewKeyFor,
  publicUrlFor,
  recommendedModelFor,
  slugFor,
  trimLabel,
} from '../derive';
import type { SourceItem } from '../types';

const item = (overrides: Partial<SourceItem> = {}): SourceItem => ({
  author: { avatar: 'https://pbs.twimg.com/a.jpg', name: 'Jane Doe', username: 'jane_doe' },
  id: '2091040255818236292',
  prompt: 'a plain prompt',
  ...overrides,
});

describe('slugFor / media keys', () => {
  it('derives a stable slug and object keys', () => {
    expect(slugFor('123')).toBe('trend-123');
    expect(previewKeyFor('123', 'video')).toBe('presets/trend-123.mp4');
    expect(previewKeyFor('123', 'image')).toBe('presets/trend-123.webp');
    expect(posterKeyFor('123')).toBe('presets/trend-123.webp');
    expect(publicUrlFor('presets/trend-123.mp4')).toBe(
      'https://ask.gptweb.ru/s3/lobe/presets/trend-123.mp4',
    );
  });
});

describe('recommendedModelFor', () => {
  it('pins i2v video presets to the paired text-to-video card, not an image-to-video id', () => {
    expect(recommendedModelFor('video', true)).toBe(I2V_RECOMMENDED_MODEL);
    // The i2v cards are disabled in model-bank; the UI could never switch to one.
    expect(I2V_RECOMMENDED_MODEL).not.toContain('image-to-video');
  });

  it('routes to the image-to-video endpoint once a reference image is attached', () => {
    expect(resolveVideoEndpoint(I2V_RECOMMENDED_MODEL, { imageUrl: 'https://cdn/x.jpg' })).toBe(
      'bytedance/seedance-2.0-fast/image-to-video',
    );
    expect(resolveVideoEndpoint(I2V_RECOMMENDED_MODEL, { imageUrl: null })).toBe(
      I2V_RECOMMENDED_MODEL,
    );
  });

  it('leaves t2v and image presets on the modality default', () => {
    expect(recommendedModelFor('video', false)).toBe(DEFAULT_MODEL.video);
    expect(recommendedModelFor('image', true)).toBe(DEFAULT_MODEL.image);
    expect(recommendedModelFor('image', false)).toBe(DEFAULT_MODEL.image);
  });
});

describe('deriveAttribution', () => {
  it('builds both X links from the username and the tweet snowflake', () => {
    expect(deriveAttribution(item())).toEqual({
      authorAvatar: 'https://pbs.twimg.com/a.jpg',
      authorName: 'Jane Doe',
      authorUrl: 'https://x.com/jane_doe',
      sourcePlatform: 'x',
      sourceUrl: 'https://x.com/jane_doe/status/2091040255818236292',
    });
  });

  it('ignores the payload profileUrl so upstream cannot redirect the source link', () => {
    const result = deriveAttribution(
      item({ author: { profileUrl: 'https://evil.example/x', username: 'jane_doe' } }),
    );
    expect(result.authorUrl).toBe('https://x.com/jane_doe');
  });

  it('falls back to the display name when there is no username', () => {
    const result = deriveAttribution(item({ author: { name: 'Jane Doe' } }));
    expect(result).toMatchObject({ authorName: 'Jane Doe', authorUrl: null, sourceUrl: null });
  });

  it('rejects a username that is not a plausible X handle', () => {
    const result = deriveAttribution(item({ author: { username: 'not/a handle' } }));
    expect(result.sourceUrl).toBeNull();
  });

  it('keeps a unicode display name intact', () => {
    expect(
      deriveAttribution(item({ author: { name: 'Zar⭕on', username: 'Xaroon_x' } })),
    ).toMatchObject({ authorName: 'Zar⭕on', authorUrl: 'https://x.com/Xaroon_x' });
  });
});

describe('deriveCategory', () => {
  it.each([
    ['cel-shaded anime girl walking through Tokyo', 'anime'],
    ['a claymation fox in a stop-motion diorama', '3d'],
    ['premium cinematic tech commercial, smartphone unboxing', 'ad'],
    ['pov selfie vlog walking through a night market', 'vlog'],
    ['a slow explosion with particle debris', 'effects'],
    ['a rooftop parkour chase across the skyline', 'action'],
    ['aerial drone shot orbiting a lighthouse', 'camera'],
    ['a dragon circling a wizard tower', 'fantasy'],
  ])('maps %s → %s for video', (prompt, expected) => {
    expect(deriveCategory(prompt, 'video')).toBe(expected);
  });

  it.each([
    ['studio ghibli style village', 'anime'],
    ['a studio headshot of an older man', 'portrait'],
    ['sweeping mountain landscape at dawn', 'landscape'],
    ['clean product photography of a perfume bottle', 'product'],
    ['photorealistic street scene', 'realistic'],
    ['a watercolour illustration of a harbour', 'artistic'],
  ])('maps %s → %s for image', (prompt, expected) => {
    expect(deriveCategory(prompt, 'image')).toBe(expected);
  });

  it('falls back to a generic slug rather than guessing', () => {
    expect(deriveCategory('an unremarkable description of nothing', 'video')).toBe(
      FALLBACK_CATEGORY,
    );
    expect(deriveCategory('', 'image')).toBe(FALLBACK_CATEGORY);
  });
});

describe('trimLabel', () => {
  it('leaves short labels alone', () => {
    expect(trimLabel('Портрет')).toBe('Портрет');
  });

  it('cuts on a word boundary and strips trailing punctuation', () => {
    const result = trimLabel('Premium cinematic live-action tech commercial for a phone', 40);
    expect(result.length).toBeLessThanOrEqual(40);
    expect(result).toBe('Premium cinematic live-action tech');
  });

  it('hard-cuts when there is no usable space', () => {
    expect(trimLabel('a'.repeat(60), 10)).toBe('a'.repeat(10));
  });

  it('collapses whitespace', () => {
    expect(trimLabel('  two   words  ')).toBe('two words');
  });
});

describe('deriveTitle', () => {
  it('combines subject and style when both are detectable', () => {
    expect(
      deriveTitle(item({ prompt: 'cinematic aerial drone shot over a mountain landscape' })),
    ).toBe('Пейзаж: аэросъёмка');
  });

  it('uses the subject alone when no style matches', () => {
    expect(deriveTitle(item({ prompt: 'a tabby cat sitting on a windowsill' }))).toBe('Животные');
  });

  it('capitalises a style-only title', () => {
    expect(deriveTitle(item({ prompt: 'shot in glorious black and white' }))).toBe('Ч/б');
  });

  it('falls back to the trimmed source title when nothing matches', () => {
    const result = deriveTitle(
      item({
        prompt: 'an entirely unremarkable description',
        title: 'STYLE: an entirely unremarkable description of a scene that goes on and on...',
      }),
    );
    expect(result.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(result).toBe('STYLE: an entirely unremarkable');
  });

  it('never returns an empty title', () => {
    expect(deriveTitle(item({ prompt: '', title: '' }))).toBe('trend-2091040255818236292');
  });

  it('keeps every derived title within the card budget', () => {
    const prompts = [
      'cinematic anime portrait close-up of the face of a woman',
      'photorealistic product photography, timelapse, unboxing',
      'a cyberpunk neon-lit city street with a robot',
    ];
    for (const prompt of prompts) {
      expect(deriveTitle(item({ prompt })).length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    }
  });
});

describe('isSourcePostId', () => {
  it('accepts an X snowflake', () => {
    expect(isSourcePostId('2091040255818236292')).toBe(true);
  });

  it('rejects the source’s own community uploads', () => {
    // seen live on /api/images — there is no X post behind these
    expect(isSourcePostId('community_34e69cb0-4906-44d1-b52e-a4ff78d5714f')).toBe(false);
  });

  it('drops the source link (but keeps the author) for a non-post id', () => {
    const result = deriveAttribution(item({ id: 'community_34e69cb0' }));
    expect(result.sourceUrl).toBeNull();
    expect(result.authorUrl).toBe('https://x.com/jane_doe');
  });
});
