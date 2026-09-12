import { describe, expect, it } from 'vitest';

import { familyOf, sameFamily } from './modelFamilies';

const MINI = 'bytedance/seedance-2.0-mini/text-to-video';
const FAST = 'bytedance/seedance-2.0-fast/text-to-video';
const KLING = 'kwaivgi/kling-v3.0-pro/text-to-video';

describe('model families', () => {
  it('groups the Seedance 2.0 tiers and nothing else', () => {
    expect(familyOf(MINI)?.id).toBe('seedance-2.0');
    expect(familyOf(FAST)?.id).toBe('seedance-2.0');
    expect(familyOf(KLING)).toBeNull();
    expect(familyOf(undefined)).toBeNull();
  });

  it('treats family members as the same choice for a style', () => {
    expect(sameFamily(MINI, FAST)).toBe(true);
    expect(sameFamily(FAST, FAST)).toBe(true);
    expect(sameFamily(FAST, KLING)).toBe(false);
    expect(sameFamily(KLING, KLING)).toBe(true);
    expect(sameFamily(null, FAST)).toBe(false);
  });
});
