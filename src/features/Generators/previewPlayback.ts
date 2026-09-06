/**
 * Decides which preset previews are allowed to play right now.
 *
 * Every card used to autoplay the moment it first intersected, and the
 * observer then disconnected — so playback never stopped. Scrolling a
 * ~1000-row gallery left dozens of MP4s decoding forever, which is what
 * actually burns battery and bandwidth on the mobile / throttled
 * connections most of our users are on.
 *
 * So playback becomes a scarce resource handed out by one module-level
 * coordinator: at most `max` previews play at a time, and the winners are
 * whichever cards the user is most plausibly looking at — a hovered card
 * first (desktop intent), otherwise the most-visible card that opted into
 * autoplay (mobile). Everyone else is told to stop and release.
 */

/** Desktop: the hovered card plus at most one autoplaying neighbour. */
export const MAX_CONCURRENT_DESKTOP = 2;
/** Mobile: one decoder at a time, full stop. */
export const MAX_CONCURRENT_MOBILE = 1;

/** A hovered card outranks any purely-visible one, whatever its ratio. */
const HOVER_PRIORITY = 1000;

export interface PreviewState {
  /**
   * Whether this preview may start on visibility alone. False on desktop
   * cards, where playback is an explicit hover intent.
   */
  autoplayInView: boolean;
  hovered: boolean;
  /** Fraction of the element inside the viewport, 0…1. */
  ratio: number;
}

interface Entry extends PreviewState {
  onChange: (granted: boolean) => void;
}

const isEligible = (e: Entry): boolean => e.hovered || (e.autoplayInView && e.ratio > 0);

const score = (e: Entry): number => (e.hovered ? HOVER_PRIORITY : 0) + e.ratio;

export interface PlaybackCoordinator {
  /** Test seam: run a pending recompute immediately. */
  flush: () => void;
  /** Subscribe a preview; the callback fires whenever its grant flips. */
  register: (onChange: (granted: boolean) => void) => number;
  setMax: (max: number) => void;
  unregister: (id: number) => void;
  update: (id: number, patch: Partial<PreviewState>) => void;
}

export const createPlaybackCoordinator = (
  initialMax = MAX_CONCURRENT_DESKTOP,
): PlaybackCoordinator => {
  const entries = new Map<number, Entry>();
  let granted = new Set<number>();
  let max = initialMax;
  let nextId = 0;
  let scheduled = false;

  const flush = (): void => {
    scheduled = false;

    // Ties keep insertion order (Array#sort is stable), so equally visible
    // cards resolve to the one earlier in the grid — i.e. higher-ranked.
    const winners = [...entries]
      .filter(([, e]) => isEligible(e))
      .sort((a, b) => score(b[1]) - score(a[1]))
      .slice(0, max)
      .map(([id]) => id);

    const next = new Set(winners);

    // Revoke before granting: the point of the cap is that we never hold
    // more than `max` live decoders, not even for one frame.
    for (const id of granted) if (!next.has(id)) entries.get(id)?.onChange(false);
    for (const id of next) if (!granted.has(id)) entries.get(id)?.onChange(true);

    granted = next;
  };

  const schedule = (): void => {
    if (scheduled) return;
    scheduled = true;
    // IntersectionObserver reports each card through its own callback, so a
    // single scroll produces a burst of updates. Coalesce them into one
    // recompute instead of thrashing play/pause on the way past.
    queueMicrotask(flush);
  };

  return {
    flush,
    register: (onChange) => {
      const id = nextId++;
      entries.set(id, { autoplayInView: false, hovered: false, onChange, ratio: 0 });
      schedule();
      return id;
    },
    setMax: (value) => {
      if (value === max) return;
      max = value;
      schedule();
    },
    unregister: (id) => {
      // Revoke synchronously rather than waiting for the next recompute: the
      // caller may be re-registering (a prop changed) and must not be left
      // believing it still holds a slot it no longer has.
      if (granted.delete(id)) entries.get(id)?.onChange(false);
      entries.delete(id);
      schedule();
    },
    update: (id, patch) => {
      const entry = entries.get(id);
      if (!entry) return;
      Object.assign(entry, patch);
      schedule();
    },
  };
};

/** The one coordinator every preview on the page shares. */
export const previewPlayback = createPlaybackCoordinator();
