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
 *
 * Three rules keep that from turning into a `<video>` per tile passed —
 * every mount is a fresh MP4 fetch and a decoder spin-up, which is the
 * "browser is thinking" the owner reported (measured before: 45 mounts per
 * 10 s wheel sweep on desktop, 93 on a phone):
 *
 *   - **Hover intent.** A hover counts only after `HOVER_INTENT_MS` of the
 *     pointer resting on the card *since the last scroll event*. A cursor
 *     crossing tiles, or sitting still while the page moves under it, never
 *     qualifies. Keyboard focus is deliberate and counts at once.
 *   - **Scroll-idle gate.** While anything on the page is scrolling nothing
 *     new is granted (revocations still happen immediately); grants resume
 *     `SCROLL_IDLE_MS` after the last scroll event.
 *   - **Sticky grants.** A card that is playing keeps its slot until it is
 *     mostly off screen (`RELEASE_RATIO`); a neighbour must be at least
 *     `ENGAGE_RATIO` visible to take over. Only a hover displaces it early.
 */

/** Desktop: the hovered card plus at most one autoplaying neighbour. */
export const MAX_CONCURRENT_DESKTOP = 2;
/** Mobile: one decoder at a time, full stop. */
export const MAX_CONCURRENT_MOBILE = 1;

/**
 * Quiet time after the last scroll event before new playback may start.
 * Longer than the gap between hesitant wheel notches (a synthetic sweep with
 * ~260 ms pauses still mounted a clip every other notch at 200 ms) and the
 * tail of a momentum scroll; shorter than anyone waits for a thumbnail to
 * start moving.
 */
export const SCROLL_IDLE_MS = 300;

/**
 * How long the pointer must rest on a card, after the last scroll, before
 * the hover counts as intent. A crossing cursor passes a tile in well under
 * this; a deliberate pause reads as instant at this scale.
 */
export const HOVER_INTENT_MS = 300;

/**
 * Visibility a card needs to *start* on visibility alone, and the lower bar
 * at which a card that is already playing gets to *keep* its slot. Without
 * the gap the "most visible" card flips on every scroll step.
 */
export const ENGAGE_RATIO = 0.5;
export const RELEASE_RATIO = 0.25;

/** A hovered / focused card outranks any purely-visible one, whatever its ratio. */
const HOVER_PRIORITY = 1000;
/** A playing card outranks any not-yet-playing one of any visibility (< hover). */
const STICKY_PRIORITY = 10;

export interface PreviewState {
  /**
   * Whether this preview may start on visibility alone. False on desktop
   * cards, where playback is an explicit hover intent.
   */
  autoplayInView: boolean;
  /** Keyboard focus — treated as hover intent without the delay. */
  focused: boolean;
  hovered: boolean;
  /** Fraction of the element inside the viewport, 0…1. */
  ratio: number;
}

interface Entry extends PreviewState {
  /** When the current hover began, or the last scroll event during it. */
  hoveredSince: number;
  onChange: (granted: boolean) => void;
}

export interface PlaybackCoordinator {
  /** Test seam: run a pending recompute immediately. */
  flush: () => void;
  /**
   * Report scroll activity. New grants are withheld until `idleMs` pass
   * without another call and every pending hover intent restarts.
   */
  noteScroll: () => void;
  /** Subscribe a preview; the callback fires whenever its grant flips. */
  register: (onChange: (granted: boolean) => void) => number;
  setMax: (max: number) => void;
  unregister: (id: number) => void;
  update: (id: number, patch: Partial<PreviewState>) => void;
}

export interface CoordinatorOptions {
  /** Steady-hover time before a hover counts. */
  hoverIntentMs?: number;
  /** Quiet time after a scroll before grants resume. */
  idleMs?: number;
  /** Clock, overridable for tests. */
  now?: () => number;
}

export const createPlaybackCoordinator = (
  initialMax = MAX_CONCURRENT_DESKTOP,
  {
    hoverIntentMs = HOVER_INTENT_MS,
    idleMs = SCROLL_IDLE_MS,
    now = Date.now,
  }: CoordinatorOptions = {},
): PlaybackCoordinator => {
  const entries = new Map<number, Entry>();
  let granted = new Set<number>();
  let max = initialMax;
  let nextId = 0;
  let scheduled = false;

  /** Timestamp before which the gallery counts as still scrolling. */
  let scrollingUntil = 0;

  // One timer for everything time-based (scroll idle, hover intent): `flush`
  // works out the earliest moment eligibility can change and asks to be
  // woken then. Never re-armed for a later time than it already holds, so a
  // burst of scroll events costs one timer, not one per event.
  let wakeTimer: ReturnType<typeof setTimeout> | null = null;
  let wakeAt = Infinity;

  const wake = (at: number): void => {
    if (wakeTimer !== null && at >= wakeAt) return;
    if (wakeTimer !== null) clearTimeout(wakeTimer);
    wakeAt = at;
    wakeTimer = setTimeout(
      () => {
        wakeTimer = null;
        wakeAt = Infinity;
        flush();
      },
      Math.max(0, at - now()),
    );
  };

  const flush = (): void => {
    scheduled = false;
    const t = now();
    const settling = t < scrollingUntil;
    let nextWake = settling ? scrollingUntil : Infinity;

    const hasIntent = (e: Entry): boolean => {
      if (e.focused) return true;
      if (!e.hovered) return false;
      const ready = e.hoveredSince + hoverIntentMs;
      if (t >= ready) return true;
      nextWake = Math.min(nextWake, ready);
      return false;
    };

    const isEligible = (e: Entry, playing: boolean): boolean =>
      hasIntent(e) || (e.autoplayInView && e.ratio >= (playing ? RELEASE_RATIO : ENGAGE_RATIO));

    const score = (e: Entry, playing: boolean): number =>
      (hasIntent(e) ? HOVER_PRIORITY : 0) + (playing ? STICKY_PRIORITY : 0) + e.ratio;

    // Ties keep insertion order (Array#sort is stable), so equally visible
    // cards resolve to the one earlier in the grid — i.e. higher-ranked.
    const winners = [...entries]
      .filter(([id, e]) => isEligible(e, granted.has(id)))
      .sort((a, b) => score(b[1], granted.has(b[0])) - score(a[1], granted.has(a[0])))
      .slice(0, max)
      .map(([id]) => id);

    // Mid-scroll only previews that already hold a slot may keep it; the
    // wake below runs this again to hand out the rest once things settle.
    const next = new Set(settling ? winners.filter((id) => granted.has(id)) : winners);

    // Revoke before granting: the point of the cap is that we never hold
    // more than `max` live decoders, not even for one frame.
    for (const id of granted) if (!next.has(id)) entries.get(id)?.onChange(false);
    for (const id of next) if (!granted.has(id)) entries.get(id)?.onChange(true);

    granted = next;

    if (nextWake < Infinity) wake(nextWake);
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
    noteScroll: () => {
      const t = now();
      scrollingUntil = t + idleMs;
      // The page moved under the cursor: whatever it is over now, it has
      // not been resting on it. Hover intent starts over.
      for (const e of entries.values()) if (e.hovered) e.hoveredSince = t;
      wake(scrollingUntil);
    },
    register: (onChange) => {
      const id = nextId++;
      entries.set(id, {
        autoplayInView: false,
        focused: false,
        hovered: false,
        hoveredSince: 0,
        onChange,
        ratio: 0,
      });
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
      if (patch.hovered && !entry.hovered) entry.hoveredSince = now();
      Object.assign(entry, patch);
      schedule();
    },
  };
};

/** The one coordinator every preview on the page shares. */
export const previewPlayback = createPlaybackCoordinator();

// --- scroll activity feed ------------------------------------------------------

let scrollListeners = 0;
const onAnyScroll = (): void => previewPlayback.noteScroll();

/**
 * Feeds every scroll on the page — the gallery's own scroll container, the
 * window, anything — to the shared coordinator. `scroll` does not bubble but
 * it does capture, so one capturing listener on the document hears all
 * scrollers without knowing which element the gallery lives in. Refcounted:
 * the listener exists only while at least one preview is mounted.
 */
export const subscribeScrollActivity = (): (() => void) => {
  if (typeof document === 'undefined') return () => {};
  if (scrollListeners++ === 0) {
    document.addEventListener('scroll', onAnyScroll, { capture: true, passive: true });
  }
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    if (--scrollListeners === 0) document.removeEventListener('scroll', onAnyScroll, true);
  };
};
