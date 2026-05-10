'use client';

import { memo, useEffect, useRef, useState } from 'react';

interface Props {
  /** Treats the component as decorative inside a clickable parent. */
  ariaHidden?: boolean;
  className?: string;
  /** When true, autoplay only when card is in viewport (saves bandwidth on long lists). */
  lazyAutoplay?: boolean;
  /** Optional poster shown before mp4 loads. */
  posterUrl?: string;
  previewUrl: string;
}

/**
 * Lazy-loaded looping muted MP4 used for preset thumbnails.
 *
 * - Defers `<video src>` assignment until the element scrolls into view
 *   (IntersectionObserver) when `lazyAutoplay` is true.
 * - `playsinline` + `muted` is required for autoplay on iOS Safari.
 */
const PresetMP4Player = memo<Props>(
  ({ ariaHidden, className, lazyAutoplay = true, posterUrl, previewUrl }) => {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [shouldLoad, setShouldLoad] = useState(!lazyAutoplay);

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
      />
    );
  },
);

PresetMP4Player.displayName = 'PresetMP4Player';

export default PresetMP4Player;
