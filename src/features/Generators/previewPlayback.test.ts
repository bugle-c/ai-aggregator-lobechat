import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createPlaybackCoordinator,
  ENGAGE_RATIO,
  HOVER_INTENT_MS,
  type PreviewState,
  RELEASE_RATIO,
  SCROLL_IDLE_MS,
} from './previewPlayback';

/** Registers a preview and exposes the grants it received. */
const addPreview = (
  coordinator: ReturnType<typeof createPlaybackCoordinator>,
  state?: Partial<PreviewState>,
) => {
  const onChange = vi.fn();
  const id = coordinator.register(onChange);
  if (state) coordinator.update(id, state);
  return { granted: () => onChange.mock.calls.at(-1)?.[0] ?? false, id, onChange };
};

// Hover intent and the scroll gate are time-based; fake timers make both
// deterministic and let the coordinator's own wake timer fire.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/**
 * A hover that has rested long enough to count. The flush stands in for the
 * microtask recompute a real update triggers (the test body is synchronous,
 * so that microtask never gets to run); it is what arms the wake timer.
 */
const settleHover = (c: ReturnType<typeof createPlaybackCoordinator>) => {
  c.flush();
  vi.advanceTimersByTime(HOVER_INTENT_MS);
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
    expect(a.onChange).not.toHaveBeenCalled();
    settleHover(c);
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
    settleHover(c);

    expect(hovered.granted()).toBe(true);
    expect(visible.granted()).toBe(false);
  });

  it('treats keyboard focus as intent without the hover delay', () => {
    const c = createPlaybackCoordinator(1);
    const a = addPreview(c, { autoplayInView: false, focused: true });
    c.flush();
    expect(a.granted()).toBe(true);

    c.update(a.id, { focused: false });
    c.flush();
    expect(a.granted()).toBe(false);
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

describe('sticky grants', () => {
  it('needs ENGAGE_RATIO to start on visibility alone', () => {
    const c = createPlaybackCoordinator(1);
    const a = addPreview(c, { autoplayInView: true, ratio: ENGAGE_RATIO - 0.01 });
    c.flush();
    expect(a.onChange).not.toHaveBeenCalled();

    c.update(a.id, { ratio: ENGAGE_RATIO });
    c.flush();
    expect(a.granted()).toBe(true);
  });

  it('keeps the playing card over a more visible neighbour until it is mostly gone', () => {
    const c = createPlaybackCoordinator(1);
    const playing = addPreview(c, { autoplayInView: true, ratio: 1 });
    c.flush();
    expect(playing.granted()).toBe(true);

    const neighbour = addPreview(c, { autoplayInView: true, ratio: 1 });
    c.update(playing.id, { ratio: 0.5 });
    c.flush();
    expect(playing.granted()).toBe(true);
    expect(neighbour.onChange).not.toHaveBeenCalled();

    c.update(playing.id, { ratio: RELEASE_RATIO });
    c.flush();
    expect(playing.granted()).toBe(true);

    c.update(playing.id, { ratio: 0.1 });
    c.flush();
    expect(playing.granted()).toBe(false);
    expect(neighbour.granted()).toBe(true);
  });

  it('a settled hover still displaces a playing card', () => {
    const c = createPlaybackCoordinator(1);
    const playing = addPreview(c, { autoplayInView: true, ratio: 1 });
    c.flush();
    const hovered = addPreview(c, { autoplayInView: false, hovered: true });
    settleHover(c);
    expect(hovered.granted()).toBe(true);
    expect(playing.granted()).toBe(false);
  });
});

describe('hover intent', () => {
  it('a cursor crossing a tile never counts', () => {
    const c = createPlaybackCoordinator(2);
    const a = addPreview(c, { autoplayInView: false, hovered: true });
    vi.advanceTimersByTime(HOVER_INTENT_MS - 50);
    c.update(a.id, { hovered: false });
    vi.advanceTimersByTime(HOVER_INTENT_MS);
    expect(a.onChange).not.toHaveBeenCalled();
  });

  it('restarts when the page scrolls under a resting cursor', () => {
    const c = createPlaybackCoordinator(2);
    const a = addPreview(c, { autoplayInView: false, hovered: true });
    vi.advanceTimersByTime(HOVER_INTENT_MS - 50);
    c.noteScroll();
    // The original intent moment passes and the rest almost completes
    // again: still nothing — the clock restarted at the scroll.
    vi.advanceTimersByTime(HOVER_INTENT_MS - 1);
    expect(a.onChange).not.toHaveBeenCalled();
    // The full rest, counted from the scroll, is what qualifies (the idle
    // window is no longer than it, so it is not what is being waited for).
    expect(SCROLL_IDLE_MS).toBeLessThanOrEqual(HOVER_INTENT_MS);
    vi.advanceTimersByTime(1);
    expect(a.granted()).toBe(true);
  });

  it('leaving releases the slot immediately', () => {
    const c = createPlaybackCoordinator(1);
    const a = addPreview(c, { autoplayInView: false, hovered: true });
    settleHover(c);
    expect(a.granted()).toBe(true);
    c.update(a.id, { hovered: false });
    c.flush();
    expect(a.granted()).toBe(false);
  });
});

describe('scroll-idle gate', () => {
  it('withholds new grants while scrolling and hands them out once idle', () => {
    const c = createPlaybackCoordinator(2);
    const a = addPreview(c, { autoplayInView: true, ratio: 1 });

    c.noteScroll();
    c.flush();
    expect(a.onChange).not.toHaveBeenCalled();

    // Still scrolling: the timer re-arms instead of granting.
    vi.advanceTimersByTime(SCROLL_IDLE_MS - 20);
    c.noteScroll();
    vi.advanceTimersByTime(SCROLL_IDLE_MS - 20);
    expect(a.onChange).not.toHaveBeenCalled();

    // Quiet for the full idle window: the pending winner is granted without
    // anyone calling flush.
    vi.advanceTimersByTime(30);
    expect(a.granted()).toBe(true);
  });

  it('keeps revoking during a scroll', () => {
    const c = createPlaybackCoordinator(1);
    const a = addPreview(c, { autoplayInView: true, ratio: 1 });
    c.flush();
    expect(a.granted()).toBe(true);

    c.noteScroll();
    c.update(a.id, { ratio: 0 });
    c.flush();
    expect(a.granted()).toBe(false);
  });

  it('lets an already-granted preview keep its slot through a scroll', () => {
    const c = createPlaybackCoordinator(1);
    const a = addPreview(c, { autoplayInView: true, ratio: 1 });
    c.flush();

    c.noteScroll();
    c.update(a.id, { ratio: 0.5 });
    c.flush();
    expect(a.granted()).toBe(true);
    expect(a.onChange).toHaveBeenCalledTimes(1);
  });

  it('a sweep of hovers mid-scroll mounts nothing; the card the cursor rests on plays after', () => {
    const c = createPlaybackCoordinator(2);
    const tiles = Array.from({ length: 5 }, () => addPreview(c, { autoplayInView: false }));

    // Cursor passes tile 0 → 1 → 2 → 3, one per wheel notch, each notch a
    // short burst of scroll events — the owner's "прокрутка вкладки стилей".
    for (let i = 0; i < 4; i++) {
      if (i > 0) c.update(tiles[i - 1].id, { hovered: false });
      c.update(tiles[i].id, { hovered: true });
      for (let k = 0; k < 4; k++) {
        c.noteScroll();
        vi.advanceTimersByTime(30);
      }
      vi.advanceTimersByTime(HOVER_INTENT_MS - 100);
    }
    for (const t of tiles) expect(t.onChange).not.toHaveBeenCalled();

    // Cursor rests on tile 3 and the wheel stops: it plays, alone.
    vi.advanceTimersByTime(HOVER_INTENT_MS);
    expect(tiles[3].granted()).toBe(true);
    expect(tiles.filter((t) => t.granted())).toHaveLength(1);
  });

  it('uses the injected clock and windows', () => {
    let time = 0;
    const c = createPlaybackCoordinator(1, { hoverIntentMs: 100, idleMs: 500, now: () => time });
    const a = addPreview(c, { autoplayInView: true, ratio: 1 });

    c.noteScroll();
    c.flush();
    expect(a.onChange).not.toHaveBeenCalled();

    time = 499;
    c.flush();
    expect(a.onChange).not.toHaveBeenCalled();

    time = 500;
    c.flush();
    expect(a.granted()).toBe(true);

    const b = addPreview(c, { autoplayInView: false, hovered: true });
    time = 599;
    c.flush();
    expect(b.onChange).not.toHaveBeenCalled();
    time = 600;
    c.flush();
    expect(b.granted()).toBe(true);
  });
});
