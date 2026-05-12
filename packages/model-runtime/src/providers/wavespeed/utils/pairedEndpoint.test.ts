import { describe, expect, it } from 'vitest';

import { resolveImageEndpoint, resolveVideoEndpoint } from './pairedEndpoint';

describe('resolveImageEndpoint', () => {
  it('swaps nano-banana-2 text-to-image to edit when imageUrls non-empty', () => {
    const result = resolveImageEndpoint('google/nano-banana-2/text-to-image', {
      imageUrls: ['https://example.com/ref.png'],
      prompt: 'turn this into watercolor',
    });
    expect(result).toBe('google/nano-banana-2/edit');
  });

  it('swaps nano-banana-pro text-to-image to edit', () => {
    expect(
      resolveImageEndpoint('google/nano-banana-pro/text-to-image', {
        imageUrls: ['ref.png'],
      }),
    ).toBe('google/nano-banana-pro/edit');
  });

  it('swaps gpt-image-2 text-to-image to edit', () => {
    expect(
      resolveImageEndpoint('openai/gpt-image-2/text-to-image', { imageUrls: ['ref.png'] }),
    ).toBe('openai/gpt-image-2/edit');
  });

  it('triggers swap from singular imageUrl param', () => {
    expect(
      resolveImageEndpoint('google/nano-banana-2/text-to-image', {
        imageUrl: 'https://example.com/ref.png',
      }),
    ).toBe('google/nano-banana-2/edit');
  });

  it('triggers swap from legacy `image` param', () => {
    expect(resolveImageEndpoint('google/nano-banana-2/text-to-image', { image: 'ref.png' })).toBe(
      'google/nano-banana-2/edit',
    );
  });

  it('does not swap when imageUrls is empty array', () => {
    expect(resolveImageEndpoint('google/nano-banana-2/text-to-image', { imageUrls: [] })).toBe(
      'google/nano-banana-2/text-to-image',
    );
  });

  it('does not swap when no reference image fields present', () => {
    expect(resolveImageEndpoint('google/nano-banana-2/text-to-image', { prompt: 'hello' })).toBe(
      'google/nano-banana-2/text-to-image',
    );
  });

  it('returns standalone edit-only model unchanged with or without images', () => {
    expect(resolveImageEndpoint('alibaba/qwen-image-edit', {})).toBe('alibaba/qwen-image-edit');
    expect(resolveImageEndpoint('alibaba/qwen-image-edit', { imageUrls: ['ref.png'] })).toBe(
      'alibaba/qwen-image-edit',
    );
  });

  it('returns unknown ids unchanged regardless of params', () => {
    expect(resolveImageEndpoint('foo/bar/text-to-image', { imageUrls: ['ref.png'] })).toBe(
      'foo/bar/text-to-image',
    );
  });

  it('handles null params without throwing', () => {
    expect(resolveImageEndpoint('google/nano-banana-2/text-to-image', null)).toBe(
      'google/nano-banana-2/text-to-image',
    );
  });
});

describe('resolveVideoEndpoint', () => {
  const pairs: Array<[string, string]> = [
    ['alibaba/wan-2.7/text-to-video', 'alibaba/wan-2.7/image-to-video'],
    ['bytedance/seedance-2.0-fast/text-to-video', 'bytedance/seedance-2.0-fast/image-to-video'],
    ['bytedance/seedance-2.0/text-to-video', 'bytedance/seedance-2.0/image-to-video'],
    ['google/veo3.1-fast/text-to-video', 'google/veo3.1-fast/image-to-video'],
    ['google/veo3.1/text-to-video', 'google/veo3.1/image-to-video'],
    ['kwaivgi/kling-v2.6-pro/text-to-video', 'kwaivgi/kling-v2.6-pro/image-to-video'],
    ['kwaivgi/kling-v3.0-pro/text-to-video', 'kwaivgi/kling-v3.0-pro/image-to-video'],
    ['openai/sora-2/text-to-video', 'openai/sora-2/image-to-video'],
  ];

  it.each(pairs)('swaps %s to %s when imageUrl present', (t2v, i2v) => {
    expect(resolveVideoEndpoint(t2v, { imageUrl: 'ref.png' })).toBe(i2v);
  });

  it.each(pairs)('keeps %s unchanged with no reference', (t2v) => {
    expect(resolveVideoEndpoint(t2v, { prompt: 'hello' })).toBe(t2v);
  });

  it('returns unknown video ids unchanged', () => {
    expect(resolveVideoEndpoint('pika/pika-v2.2/text-to-video', { imageUrl: 'ref.png' })).toBe(
      'pika/pika-v2.2/text-to-video',
    );
  });

  it('handles null params', () => {
    expect(resolveVideoEndpoint('openai/sora-2/text-to-video', null)).toBe(
      'openai/sora-2/text-to-video',
    );
  });
});
