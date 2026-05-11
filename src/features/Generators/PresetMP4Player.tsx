'use client';

import { memo, useEffect, useRef, useState } from 'react';

interface Props {
  /** Treats the component as decorative inside a clickable parent. */
  ariaHidden?: boolean;
  className?: string;
  /** Used as the fallback label inside the placeholder if the MP4 fails to load. */
  fallbackLabel?: string;
  /** When true, autoplay only when card is in viewport (saves bandwidth on long lists). */
  lazyAutoplay?: boolean;
  /** Optional poster shown before mp4 loads. */
  posterUrl?: string;
  previewUrl: string;
}

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

/**
 * Lazy-loaded looping muted MP4 used for preset thumbnails.
 *
 * - Defers `<video src>` assignment until the element scrolls into view
 *   (IntersectionObserver) when `lazyAutoplay` is true.
 * - `playsinline` + `muted` is required for autoplay on iOS Safari.
 * - On video error (e.g. 404 — the case while preview MP4s are still
 *   being uploaded to RustFS) renders an indigo gradient placeholder
 *   with the preset title so the card never goes black.
 */
const PresetMP4Player = memo<Props>(
  ({ ariaHidden, className, fallbackLabel, lazyAutoplay = true, posterUrl, previewUrl }) => {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [shouldLoad, setShouldLoad] = useState(!lazyAutoplay);
    const [errored, setErrored] = useState(false);

    useEffect(() => {
      if (!lazyAutoplay) return;
      const el = videoRef.current;
      if (!el) return;

      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              setShouldLoad(true);
              io.disconnect();
              break;
            }
          }
        },
        { rootMargin: '200px 0px' },
      );

      io.observe(el);
      return () => io.disconnect();
    }, [lazyAutoplay]);

    if (errored) return <FallbackPlaceholder label={fallbackLabel} />;

    // Static images get an <img>; videos/.mp4 stay on <video autoplay loop>.
    // Detected by extension in the URL path (ignoring query string).
    const pathOnly = previewUrl.split('?')[0].toLowerCase();
    const isImage = /\.(?:png|jpe?g|webp|avif|gif)$/.test(pathOnly);

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

    return (
      <video
        autoPlay
        loop
        muted
        playsInline
        aria-hidden={ariaHidden}
        className={className}
        poster={posterUrl}
        preload="none"
        ref={videoRef}
        src={shouldLoad ? previewUrl : undefined}
        style={{
          display: 'block',
          height: '100%',
          objectFit: 'cover',
          width: '100%',
        }}
        onError={() => setErrored(true)}
      />
    );
  },
);

PresetMP4Player.displayName = 'PresetMP4Player';

export default PresetMP4Player;
