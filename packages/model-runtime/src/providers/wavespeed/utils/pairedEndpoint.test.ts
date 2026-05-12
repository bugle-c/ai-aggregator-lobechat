import { describe, expect, it } from 'vitest';

import { resolveImageEndpoint } from './pairedEndpoint';

describe('resolveImageEndpoint', () => {
  it('swaps nano-banana-2 text-to-image to edit when imageUrls non-empty', () => {
    const result = resolveImageEndpoint('google/nano-banana-2/text-to-image', {
      imageUrls: ['https://example.com/ref.png'],
      prompt: 'turn this into watercolor',
    });
    expect(result).toBe('google/nano-banana-2/edit');
  });
});
