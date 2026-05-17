import { describe, expect, it } from 'vitest';

import type { CreateVideoPayload } from '../../../types/video';
import { buildBody } from './createVideo';

const baseParams = (
  overrides: Partial<CreateVideoPayload['params']> = {},
): CreateVideoPayload['params'] =>
  ({
    prompt: 'a cat surfing',
    ...overrides,
  }) as CreateVideoPayload['params'];

describe('wavespeed buildBody', () => {
  it('forwards prompt as-is', () => {
    expect(buildBody(baseParams())).toEqual({ prompt: 'a cat surfing' });
  });

  it('forwards a concrete aspect_ratio', () => {
    expect(buildBody(baseParams({ aspectRatio: '16:9' } as any))).toMatchObject({
      aspect_ratio: '16:9',
    });
  });

  // The historical bug: 'adaptive' is a LobeChat-internal sentinel, not a
  // value any upstream WaveSpeed model accepts. Forwarding it 400'd Kling /
  // Seedance for every user who left the default config.
  it("drops aspect_ratio when value is 'adaptive'", () => {
    const body = buildBody(baseParams({ aspectRatio: 'adaptive' } as any));
    expect(body).not.toHaveProperty('aspect_ratio');
  });

  it('drops aspect_ratio when undefined', () => {
    const body = buildBody(baseParams());
    expect(body).not.toHaveProperty('aspect_ratio');
  });

  it('maps generateAudio to enable_audio', () => {
    expect(buildBody(baseParams({ generateAudio: true } as any))).toMatchObject({
      enable_audio: true,
    });
  });

  it('drops null seed', () => {
    const body = buildBody(baseParams({ seed: null } as any));
    expect(body).not.toHaveProperty('seed');
  });

  it('renames imageUrl/endImageUrl to image/last_image', () => {
    const body = buildBody(
      baseParams({
        endImageUrl: 'https://x/b.png',
        imageUrl: 'https://x/a.png',
      } as any),
    );
    expect(body).toMatchObject({
      image: 'https://x/a.png',
      last_image: 'https://x/b.png',
    });
  });
});
