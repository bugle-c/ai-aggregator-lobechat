import { describe, expect, it } from 'vitest';

import {
  decideGenerateReadiness,
  decidePresetImageGate,
  hasReferenceImage,
} from './presetImageGate';

const i2v = { promptTemplate: 'Animate @image1 walking towards the camera', requiresImage: true };
const t2v = { promptTemplate: 'Crash zoom into {{user_prompt}}', requiresImage: false };

describe('hasReferenceImage', () => {
  it('accepts a non-empty url and nothing else', () => {
    expect(hasReferenceImage('https://cdn/x.jpg')).toBe(true);
    expect(hasReferenceImage('   ')).toBe(false);
    expect(hasReferenceImage('')).toBe(false);
    expect(hasReferenceImage(null)).toBe(false);
    expect(hasReferenceImage(undefined)).toBe(false);
    expect(hasReferenceImage(42)).toBe(false);
  });
});

describe('decidePresetImageGate', () => {
  it('does not gate a t2v preset or no preset at all', () => {
    expect(decidePresetImageGate({ imageUrl: null, preset: t2v })).toEqual({ kind: 'none' });
    expect(decidePresetImageGate({ imageUrl: null, preset: null })).toEqual({ kind: 'none' });
    expect(decidePresetImageGate({ imageUrl: null, preset: undefined })).toEqual({ kind: 'none' });
  });

  it('blocks an i2v preset until a photo is attached', () => {
    expect(decidePresetImageGate({ imageUrl: null, preset: i2v })).toEqual({ kind: 'missing' });
    expect(decidePresetImageGate({ imageUrl: 'https://cdn/x.jpg', preset: i2v })).toEqual({
      kind: 'ready',
    });
  });

  it('works on a slim list item (no promptTemplate)', () => {
    expect(decidePresetImageGate({ imageUrl: '', preset: { requiresImage: true } })).toEqual({
      kind: 'missing',
    });
  });
});

describe('decideGenerateReadiness', () => {
  it('is blocked while a run is in flight, whatever else is true', () => {
    expect(
      decideGenerateReadiness({
        imageUrl: 'https://cdn/x.jpg',
        isGenerating: true,
        preset: i2v,
        prompt: 'more',
      }),
    ).toEqual({ blocker: 'generating', canGenerate: false });
  });

  it('needs words: a typed prompt or a style with a template', () => {
    expect(
      decideGenerateReadiness({ imageUrl: null, isGenerating: false, preset: null, prompt: '  ' }),
    ).toEqual({ blocker: 'empty', canGenerate: false });
    expect(
      decideGenerateReadiness({
        imageUrl: null,
        isGenerating: false,
        preset: null,
        prompt: 'a cat',
      }),
    ).toEqual({ blocker: null, canGenerate: true });
    expect(
      decideGenerateReadiness({ imageUrl: null, isGenerating: false, preset: t2v, prompt: '' }),
    ).toEqual({ blocker: null, canGenerate: true });
  });

  it('asks for the photo of an i2v style, then lets the run through', () => {
    expect(
      decideGenerateReadiness({ imageUrl: null, isGenerating: false, preset: i2v, prompt: '' }),
    ).toEqual({ blocker: 'missing-image', canGenerate: false });
    expect(
      decideGenerateReadiness({
        imageUrl: 'https://cdn/x.jpg',
        isGenerating: false,
        preset: i2v,
        prompt: '',
      }),
    ).toEqual({ blocker: null, canGenerate: true });
  });

  it('lifts the photo requirement when the style is removed', () => {
    expect(
      decideGenerateReadiness({
        imageUrl: null,
        isGenerating: false,
        preset: null,
        prompt: 'a lighthouse at dusk',
      }),
    ).toEqual({ blocker: null, canGenerate: true });
  });

  it('reports the empty prompt before the missing photo', () => {
    // An i2v style always has a template, but a list item without one must
    // still surface the more basic problem first.
    expect(
      decideGenerateReadiness({
        imageUrl: null,
        isGenerating: false,
        preset: { requiresImage: true },
        prompt: '',
      }),
    ).toEqual({ blocker: 'empty', canGenerate: false });
  });
});
