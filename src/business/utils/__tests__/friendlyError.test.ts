import { describe, expect, it } from 'vitest';

import { friendlyChatError, friendlyGenerationError } from '../friendlyError';

const OPENROUTER_HEIC = {
  error: {
    code: 400,
    message: 'Provider returned error',
    metadata: {
      raw: '{"error":{"message":"The image data you provided does not represent a valid image. Please check your input and try again with one of the supported image formats: [\'image/jpeg\', \'image/png\']","type":"invalid_request_error"}}',
      provider_name: 'Azure',
    },
  },
};

describe('friendlyChatError', () => {
  it('turns the OpenRouter/Azure invalid-image dump into one sentence', () => {
    expect(friendlyChatError(OPENROUTER_HEIC)).toMatch(/не распознан как изображение/);
  });
  it('recognises the Anthropic media_type variant', () => {
    expect(
      friendlyChatError({
        error: { message: 'messages.0.content.1.image.source.base64.media_type: invalid' },
      }),
    ).toMatch(/не распознан/);
  });
  it('never leaks raw JSON for unknown errors', () => {
    const out = friendlyChatError({
      error: { message: 'weird upstream thing', metadata: { raw: '{"x":1}' } },
    });
    expect(out).not.toMatch(/[{}]/);
    expect(out).toMatch(/Попробуйте ещё раз/);
  });
});

describe('friendlyGenerationError', () => {
  it('WaveSpeed "image is required" → ask for a source image', () => {
    expect(
      friendlyGenerationError({
        body: {
          detail:
            'Failed to submit video task: WaveSpeed video API error: 400 {"code":400,"message":"Invalid request body: field \\"image\\" is required; please provide a value"}',
        },
      }),
    ).toMatch(/прикрепить исходное изображение/);
  });
  it('Veo duration/resolution mismatch → actionable hint', () => {
    expect(
      friendlyGenerationError({
        body: { detail: 'veo3.1-lite at 1080p requires duration=8s, got duration=6.' },
      }),
    ).toMatch(/длительности и разрешения/);
  });
  it('plain string bodies and unknown errors collapse to the generic line', () => {
    expect(friendlyGenerationError('Task failed: upstream exploded')).toMatch(/не списаны/);
    expect(friendlyGenerationError(undefined)).toMatch(/не списаны/);
  });
});
