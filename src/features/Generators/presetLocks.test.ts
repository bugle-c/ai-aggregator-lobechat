import { describe, expect, it } from 'vitest';

import type { Preset } from '@/types/preset';

import { presetLockedKeys, styleLockFor } from './presetLocks';

const preset = (over: Partial<Preset>): Preset =>
  ({
    paramsLock: {},
    requiresImage: false,
    slug: 'p',
    ...over,
  }) as Preset;

describe('presetLockedKeys', () => {
  it('maps params_lock storage names to runtime keys', () => {
    const keys = presetLockedKeys(
      preset({ paramsLock: { aspect_ratio: '9:16', duration_sec: 5 } }),
    );
    expect([...keys].sort()).toEqual(['aspectRatio', 'duration']);
  });

  it('is empty without a style', () => {
    expect(presetLockedKeys(null).size).toBe(0);
  });
});

describe('styleLockFor', () => {
  it('leaves everything free without a style', () => {
    expect(styleLockFor(null, 'imageUrl')).toBeNull();
    expect(styleLockFor(undefined, 'seed')).toBeNull();
  });

  it('marks params_lock keys as pinned by the style', () => {
    const p = preset({ paramsLock: { aspect_ratio: '16:9', resolution: '1080p' } });
    expect(styleLockFor(p, 'resolution')).toBe('value');
    expect(styleLockFor(p, 'seed')).toBeNull();
  });

  it('pins exact width/height when the style pins the aspect ratio', () => {
    const p = preset({ paramsLock: { aspect_ratio: '1:1' } });
    expect(styleLockFor(p, 'width')).toBe('value');
    expect(styleLockFor(p, 'height')).toBe('value');
    expect(styleLockFor(preset({}), 'width')).toBeNull();
  });

  it('marks reference inputs unused for a text style, free for an i2v style', () => {
    expect(styleLockFor(preset({}), 'imageUrl')).toBe('unused');
    expect(styleLockFor(preset({}), 'imageUrls')).toBe('unused');
    expect(styleLockFor(preset({ requiresImage: true }), 'imageUrl')).toBeNull();
  });

  it('never needs an end frame under a video style', () => {
    expect(styleLockFor(preset({}), 'endImageUrl', undefined, 'video')).toBe('unused');
    expect(styleLockFor(preset({ requiresImage: true }), 'endImageUrl', undefined, 'video')).toBe(
      'unused',
    );
  });
});

describe('styleLockFor — video modality', () => {
  const text = preset({});
  const i2v = preset({ requiresImage: true });

  it('locks the start frame for a text style and frees it for an i2v style', () => {
    expect(styleLockFor(text, 'imageUrl', undefined, 'video')).toBe('unused');
    expect(styleLockFor(i2v, 'imageUrl', undefined, 'video')).toBeNull();
    expect(styleLockFor(i2v, 'endImageUrl', undefined, 'video')).toBe('unused');
  });

  it('leaves reference images and videos free under any video style', () => {
    expect(styleLockFor(text, 'imageUrls', undefined, 'video')).toBeNull();
    expect(styleLockFor(text, 'videoUrls', undefined, 'video')).toBeNull();
    expect(styleLockFor(i2v, 'imageUrls', undefined, 'video')).toBeNull();
  });
});
