import { describe, expect, it } from 'vitest';

import type { PresetListItem } from '@/types/preset';

import {
  presetAspectRatio,
  TILE_ASPECT_MAX,
  TILE_ASPECT_MIN,
  tileAspectNumber,
  tileAspectRatio,
} from './presetAspect';

const preset = (aspect_ratio?: unknown): PresetListItem =>
  ({ paramsLock: aspect_ratio === undefined ? {} : { aspect_ratio } }) as PresetListItem;

describe('tileAspectNumber', () => {
  it('returns the real ratio inside the allowed range', () => {
    expect(tileAspectNumber(preset('3:4'))).toBeCloseTo(0.75);
    expect(tileAspectNumber(preset('16:9'))).toBeCloseTo(16 / 9);
    expect(tileAspectNumber(preset('1:1'))).toBe(1);
  });

  it('clamps anything taller than 9:16 and wider than 2:1', () => {
    expect(tileAspectNumber(preset('9:32'))).toBe(TILE_ASPECT_MIN);
    expect(tileAspectNumber(preset('9:16'))).toBeCloseTo(TILE_ASPECT_MIN);
    expect(tileAspectNumber(preset('21:9'))).toBe(TILE_ASPECT_MAX);
    expect(tileAspectNumber(preset('2:1'))).toBe(TILE_ASPECT_MAX);
  });

  it('falls back to 3:4 for missing, malformed or degenerate values', () => {
    expect(tileAspectNumber(preset())).toBeCloseTo(0.75);
    expect(tileAspectNumber(preset('portrait'))).toBeCloseTo(0.75);
    expect(tileAspectNumber(preset('0:4'))).toBeCloseTo(0.75);
    expect(tileAspectNumber(preset(169))).toBeCloseTo(0.75);
  });

  it('accepts the separators the ingest writes', () => {
    expect(tileAspectNumber(preset('16x9'))).toBeCloseTo(16 / 9);
    expect(tileAspectNumber(preset('16 / 9'))).toBeCloseTo(16 / 9);
  });
});

describe('tileAspectRatio', () => {
  it('is the clamped number as a CSS aspect-ratio', () => {
    expect(tileAspectRatio(preset('1:1'))).toBe('1 / 1');
    expect(tileAspectRatio(preset('9:32'))).toBe(`${TILE_ASPECT_MIN} / 1`);
  });
});

describe('presetAspectRatio', () => {
  it('keeps the unclamped true ratio for the zoom modal', () => {
    expect(presetAspectRatio(preset('21:9'))).toBe('21 / 9');
    expect(presetAspectRatio(preset())).toBe('3 / 4');
  });
});
