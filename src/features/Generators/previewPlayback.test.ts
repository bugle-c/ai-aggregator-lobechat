import { describe, expect, it, vi } from 'vitest';

import { createPlaybackCoordinator } from './previewPlayback';

/** Registers a preview and exposes the grants it received. */
const addPreview = (
  coordinator: ReturnType<typeof createPlaybackCoordinator>,
  state?: Partial<{ autoplayInView: boolean; hovered: boolean; ratio: number }>,
) => {
  const onChange = vi.fn();
  const id = coordinator.register(onChange);
  if (state) coordinator.update(id, state);
  return { granted: () => onChange.mock.calls.at(-1)?.[0] ?? false, id, onChange };
};

describe('createPlaybackCoordinator', () => {
  it('grants nothing to a preview that is neither hovered nor visible', () => {
    const c = createPlaybackCoordinator(2);
    const a = addPreview(c, { autoplayInView: true, ratio: 0 });
    c.flush();

    expect(a.onChange).not.toHaveBeenCalled();
  });

  it('never grants a desktop card on visibility alone', () => {
    const c = createPlaybackCoordinator(2);
    const a = addPreview(c, { autoplayInView: false, ratio: 1 });
    c.flush();

    expect(a.onChange).not.toHaveBeenCalled();

    c.update(a.id, { hovered: true });
    c.flush();
    expect(a.granted()).toBe(true);
  });

  it('caps concurrent playback and keeps the most visible previews', () => {
    const c = createPlaybackCoordinator(2);
    const low = addPreview(c, { autoplayInView: true, ratio: 0.1 });
    const mid = addPreview(c, { autoplayInView: true, ratio: 0.5 });
    const high = addPreview(c, { autoplayInView: true, ratio: 0.9 });
    c.flush();

    expect(high.granted()).toBe(true);
    expect(mid.granted()).toBe(true);
    expect(low.onChange).not.toHaveBeenCalled();
  });

  it('revokes a preview that scrolls out of view', () => {
    const c = createPlaybackCoordinator(1);
    const a = addPreview(c, { autoplayInView: true, ratio: 1 });
    c.flush();
    expect(a.granted()).toBe(true);

    c.update(a.id, { ratio: 0 });
    c.flush();
    expect(a.granted()).toBe(false);
  });

  it('hands the slot to a hovered card over a fully visible one', () => {
    const c = createPlaybackCoordinator(1);
    const visible = addPreview(c, { autoplayInView: true, ratio: 1 });
    c.flush();
    expect(visible.granted()).toBe(true);

    const hovered = addPreview(c, { autoplayInView: false, hovered: true, ratio: 0 });
    c.flush();

    expect(hovered.granted()).toBe(true);
    expect(visible.granted()).toBe(false);
  });

  it('frees the slot when a granted preview unmounts', () => {
    const c = createPlaybackCoordinator(1);
    const first = addPreview(c, { autoplayInView: true, ratio: 1 });
    const second = addPreview(c, { autoplayInView: true, ratio: 0.5 });
    c.flush();
    expect(first.granted()).toBe(true);
    expect(second.onChange).not.toHaveBeenCalled();

    c.unregister(first.id);
    // The grant is revoked synchronously so a re-registering component never
    // believes it still owns a slot.
    expect(first.granted()).toBe(false);

    c.flush();
    expect(second.granted()).toBe(true);
  });

  it('shrinks the granted set when the cap drops (desktop → mobile)', () => {
    const c = createPlaybackCoordinator(2);
    const high = addPreview(c, { autoplayInView: true, ratio: 0.9 });
    const mid = addPreview(c, { autoplayInView: true, ratio: 0.5 });
    c.flush();
    expect(high.granted()).toBe(true);
    expect(mid.granted()).toBe(true);

    c.setMax(1);
    c.flush();
    expect(high.granted()).toBe(true);
    expect(mid.granted()).toBe(false);
  });

  it('coalesces a burst of updates into one recompute', async () => {
    const c = createPlaybackCoordinator(2);
    const a = addPreview(c);
    c.update(a.id, { autoplayInView: true, ratio: 0.2 });
    c.update(a.id, { ratio: 0.6 });
    c.update(a.id, { ratio: 1 });

    // Nothing has run yet — the recompute is queued on a microtask.
    expect(a.onChange).not.toHaveBeenCalled();
    await Promise.resolve();

    expect(a.onChange).toHaveBeenCalledTimes(1);
    expect(a.granted()).toBe(true);
  });
});
