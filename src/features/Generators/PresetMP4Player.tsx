'use client';

import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { useIsMobile } from '@/hooks/useIsMobile';

import { MAX_CONCURRENT_DESKTOP, MAX_CONCURRENT_MOBILE, previewPlayback } from './previewPlayback';

interface Props {
  /** Treats the component as decorative inside a clickable parent. */
  ariaHidden?: boolean;
  /**
   * Allow this preview to start playing on visibility alone, competing with
   * its neighbours for one of the few concurrent playback slots. False makes
   * playback hover/focus-only, which is what gallery cards want on desktop.
   */
  autoplayInView?: boolean;
  className?: string;
  /** Used as the fallback label inside the placeholder if the MP4 fails to load. */
  fallbackLabel?: string;
  /** Still frame. This is the resting state of the card — see below. */
  posterUrl?: string;
  previewUrl: string;
}

/** Enough steps that "most visible card" is meaningfully ordered. */
const RATIO_THRESHOLDS = [0, 0.1, 0.25, 0.5, 0.75, 1];

const coverStyle = {
  blockSize: '100%',
  display: 'block',
  inlineSize: '100%',
  insetBlockStart: 0,
  insetInlineStart: 0,
  objectFit: 'cover',
  position: 'absolute',
} as const;

const FallbackPlaceholder = ({ label }: { label?: string }) => (
  <div
    aria-hidden
    style={{
      alignItems: 'center',
      background: 'linear-gradient(135deg, rgba(99,102,241,0.18) 0%, rgba(168,85,247,0.18) 100%)',
      color: 'rgba(255,255,255,0.85)',
      display: 'flex',
      fontSize: 13,
      fontWeight: 600,
      height: '100%',
      justifyContent: 'center',
      letterSpacing: '0.02em',
      padding: 8,
      textAlign: 'center',
      textTransform: 'uppercase',
      width: '100%',
    }}
  >
    {label ?? '—'}
  </div>
);

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const supportsMatchMedia = (): boolean => typeof globalThis.matchMedia === 'function';

const subscribeReducedMotion = (onChange: () => void): (() => void) => {
  if (!supportsMatchMedia()) return () => {};
  const mq = globalThis.matchMedia(REDUCED_MOTION_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
};

/**
 * Reads the OS "reduce motion" setting and keeps up with changes to it.
 * SSR and browsers without `matchMedia` fall through to "no preference".
 */
const usePrefersReducedMotion = (): boolean =>
  useSyncExternalStore(
    subscribeReducedMotion,
    () => supportsMatchMedia() && globalThis.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );

const isImageUrl = (url: string): boolean =>
  /\.(?:png|jpe?g|webp|avif|gif)$/.test(url.split('?')[0].toLowerCase());

/**
 * Poster-first preset preview.
 *
 * The resting state is the poster image — cheap, cacheable, and the only
 * thing that renders at all on a connection slow enough that an MP4 never
 * arrives. The `<video>` is mounted only while `previewPlayback` grants this
 * preview a playback slot (hover on desktop, most-visible card on mobile),
 * and is explicitly paused and detached from its source when the grant is
 * revoked, so scrolling past a card really does stop its decoder.
 *
 * `playsinline` + `muted` is required for autoplay on iOS Safari. On video
 * error (e.g. a 404 while preview MP4s are still uploading) the card falls
 * back to an indigo gradient placeholder with the preset title so it never
 * goes black.
 */
const PresetMP4Player = memo<Props>(
  ({ ariaHidden, autoplayInView = true, className, fallbackLabel, posterUrl, previewUrl }) => {
    const isMobile = useIsMobile();
    const reducedMotion = usePrefersReducedMotion();
    const isImage = isImageUrl(previewUrl);

    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const playbackIdRef = useRef<number | null>(null);
    const [playing, setPlaying] = useState(false);
    const [errored, setErrored] = useState(false);
    const [posterErrored, setPosterErrored] = useState(false);

    useEffect(() => {
      previewPlayback.setMax(isMobile ? MAX_CONCURRENT_MOBILE : MAX_CONCURRENT_DESKTOP);
    }, [isMobile]);

    // Registration and visibility reporting are one unit: a preview the
    // coordinator cannot hear from is a preview it can never revoke.
    // Reduced motion never registers at all, so it can never be granted a
    // slot — the poster is the whole experience there.
    useEffect(() => {
      const el = wrapperRef.current;
      if (!el || isImage || errored || reducedMotion) return;

      const id = previewPlayback.register(setPlaying);
      previewPlayback.update(id, { autoplayInView });
      playbackIdRef.current = id;

      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries)
            previewPlayback.update(id, { ratio: e.isIntersecting ? e.intersectionRatio : 0 });
        },
        { threshold: RATIO_THRESHOLDS },
      );
      io.observe(el);

      return () => {
        // Deliberately NOT disconnected on first intersection, only on
        // teardown: the coordinator needs to keep hearing about this card to
        // know when it has scrolled away and its slot can go to someone on
        // screen. `unregister` revokes the grant, which is what flips
        // `playing` back to false.
        io.disconnect();
        playbackIdRef.current = null;
        previewPlayback.unregister(id);
      };
    }, [autoplayInView, errored, isImage, reducedMotion]);

    const setHovered = useCallback((hovered: boolean) => {
      const id = playbackIdRef.current;
      if (id !== null) previewPlayback.update(id, { hovered });
    }, []);

    /**
     * Pausing is not enough on detach — a `<video>` removed from the DOM can
     * keep its network fetch alive. Dropping `src` and calling `load()` is
     * what actually releases the decoder and the connection.
     */
    const attachVideo = useCallback((node: HTMLVideoElement | null) => {
      if (node) {
        videoRef.current = node;
        return;
      }
      const previous = videoRef.current;
      if (previous) {
        previous.pause();
        previous.removeAttribute('src');
        previous.load();
      }
      videoRef.current = null;
    }, []);

    if (errored) return <FallbackPlaceholder label={fallbackLabel} />;

    // Static images get a plain <img>; only videos need the playback dance.
    if (isImage) {
      return (
        <img
          alt=""
          aria-hidden={ariaHidden}
          className={className}
          loading="lazy"
          src={previewUrl}
          style={{
            display: 'block',
            height: '100%',
            objectFit: 'cover',
            width: '100%',
          }}
          onError={() => setErrored(true)}
        />
      );
    }

    const hasPoster = !!posterUrl && !posterErrored;

    return (
      <div
        className={className}
        ref={wrapperRef}
        style={{ blockSize: '100%', inlineSize: '100%', position: 'relative' }}
        onBlur={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {hasPoster ? (
          <img
            aria-hidden
            alt=""
            loading="lazy"
            src={posterUrl}
            style={coverStyle}
            onError={() => setPosterErrored(true)}
          />
        ) : (
          // No poster (legacy rows) and nothing playing — better a labelled
          // gradient than the blank rectangle these cards used to be.
          !playing && <FallbackPlaceholder label={fallbackLabel} />
        )}

        {playing && (
          <video
            autoPlay
            loop
            muted
            playsInline
            aria-hidden={ariaHidden}
            poster={posterUrl}
            preload="auto"
            ref={attachVideo}
            src={previewUrl}
            style={coverStyle}
            onError={() => setErrored(true)}
          />
        )}
      </div>
    );
  },
);

PresetMP4Player.displayName = 'PresetMP4Player';

export default PresetMP4Player;
