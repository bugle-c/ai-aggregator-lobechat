'use client';

import { createStyles } from 'antd-style';
import { Maximize2, Play } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsMobile } from '@/hooks/useIsMobile';
import type { PresetBadge, PresetListItem } from '@/types/preset';

import { categoryLabel } from './PRESET_CATEGORIES';
import { tileAspectRatio } from './presetAspect';
import PresetMP4Player from './PresetMP4Player';
import RequiresImageBadge from './RequiresImageBadge';

interface Props {
  isActive?: boolean;
  /**
   * Overrides the tile's own aspect (`tileAspectRatio`). The home-page rows
   * pass one ratio per row so five thumbnails stay flush; the gallery
   * masonry leaves this unset and gets each preset's real shape.
   */
  mediaAspectRatio?: string;
  onClick: (preset: PresetListItem) => void;
  /**
   * Fired on the first hover / touch / focus, before a click can happen —
   * the place to warm whatever the selection path will need (lock state,
   * the full preset row) so the tap itself feels instant.
   */
  onPrefetch?: (preset: PresetListItem) => void;
  /**
   * Opens the details view for this preset. The modal itself lives one level
   * up (one instance for the whole list, not one per card — at ~1000 rows
   * a per-card modal meant ~1000 mounted antd dialogs). Omit to hide the
   * zoom affordance entirely. Desktop only: on touch the details live on the
   * creation screen («Подробнее» in `PresetThumbCard`), a second 28px target
   * on a 170px tile was a mis-tap magnet.
   */
  onZoom?: (preset: PresetListItem) => void;
  preset: PresetListItem;
}

const BADGE_LABELS: Record<PresetBadge, string> = {
  mixed: 'Mixed',
  new: 'New',
  top_choice: 'Top',
  trending: '🔥',
  // Higher-tier "пиар-волна" badge — text pill, reserved for the one
  // preset ops is actively featuring this month. The emoji prefix makes
  // it visually pop next to the muted Mixed/Top chips.
  trend_of_month: '🔥 Тренд месяца',
};

const BADGE_COLORS: Record<PresetBadge, string> = {
  mixed: 'rgba(120, 120, 120, 0.85)',
  new: '#dc2626',
  top_choice: '#facc15',
  trending: 'transparent',
  // Magenta — distinct from the yellow `top_choice` and the red `new`,
  // matches the editorial pink palette of the Riviera preset this badge
  // was built for.
  trend_of_month: '#e11d74',
};

/**
 * "1,2 тыс." rather than "1200" — the number is a texture cue on a 170px
 * card, not a figure anyone reads digit by digit.
 */
const compactCount = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 1,
  notation: 'compact',
});

const isVideoPreview = (preset: PresetListItem): boolean =>
  preset.modality === 'video' || /\.(?:mp4|webm|mov)$/.test(preset.previewUrl.split('?')[0]);

const useStyles = createStyles(({ css, token }) => ({
  card: css`
    cursor: pointer;

    overflow: hidden;
    display: flex;
    flex-direction: column;

    inline-size: 100%;
    margin: 0;
    padding: 0;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 12px;

    color: inherit;
    text-align: start;

    background: ${token.colorBgContainer};

    transition:
      transform 0.18s ease,
      border-color 0.18s ease;

    &:hover {
      transform: translateY(-2px);
    }

    &:focus-visible {
      outline: 2px solid ${token.colorPrimary};
      outline-offset: 2px;
    }

    /* Keyboard users get the same text layer a mouse hover shows. */
    &:hover .preset-hover-overlay,
    &:focus-visible .preset-hover-overlay,
    &:has(.preset-zoom-btn:focus-visible) .preset-hover-overlay {
      opacity: 1;
    }

    &:hover .preset-zoom-btn,
    &:focus-visible .preset-zoom-btn,
    &:has(.preset-zoom-btn:focus-visible) .preset-zoom-btn {
      pointer-events: auto;
      opacity: 1;
    }

    @media (prefers-reduced-motion: reduce) {
      transition: border-color 0.18s ease;

      &:hover {
        transform: none;
      }
    }
  `,
  cardMobile: css`
    border-radius: 10px;

    &:hover {
      transform: none;
    }

    &:active {
      transform: scale(0.98);
      transition-duration: 80ms;
    }

    @media (prefers-reduced-motion: reduce) {
      &:active {
        transform: none;
      }
    }
  `,
  active: css`
    border-color: ${token.colorPrimary};
    border-width: 2px;
  `,
  /**
   * The media box at the preset's real (clamped) aspect. The tertiary fill
   * behind the poster is the skeleton: the box already has its final size
   * before any byte of media arrives, so CLS is zero by construction.
   */
  media: css`
    position: relative;
    overflow: hidden;
    inline-size: 100%;
    background: ${token.colorFillTertiary};
  `,
  badges: css`
    pointer-events: none;

    position: absolute;
    z-index: 2;
    inset-block-start: 8px;
    inset-inline-start: 8px;

    display: flex;
    gap: 4px;
  `,
  badge: css`
    padding-block: 2px;
    padding-inline: 6px;
    border-radius: 6px;

    font-size: 11px;
    font-weight: 600;
    color: #fff;
  `,
  /**
   * "This one moves." Decorative — the card's label already says what it
   * is — and hidden while the preview actually plays, when the motion
   * itself is the cue.
   */
  playBadge: css`
    pointer-events: none;

    position: absolute;
    z-index: 2;
    inset-block-start: 8px;
    inset-inline-end: 8px;

    display: flex;
    align-items: center;
    justify-content: center;

    inline-size: 24px;
    block-size: 24px;
    border-radius: 50%;

    color: #fff;

    background: rgb(0 0 0 / 55%);
    backdrop-filter: blur(4px);

    transition: opacity 0.18s ease;
  `,
  playBadgeMobile: css`
    inline-size: 28px;
    block-size: 28px;
  `,
  /**
   * Desktop text layer: everything the mobile caption says, over the
   * bottom of the preview, on hover and on focus. Hidden outright where
   * there is no hover, so it can never be the only carrier of information.
   */
  hoverOverlay: css`
    pointer-events: none;

    position: absolute;
    z-index: 3;
    inset: 0;

    display: flex;
    flex-direction: column;
    gap: 3px;
    justify-content: flex-end;

    padding: 12px;

    opacity: 0;
    background: linear-gradient(180deg, rgb(0 0 0 / 0%) 45%, rgb(0 0 0 / 80%) 100%);

    transition: opacity 0.18s ease;

    @media (hover: none) {
      display: none;
    }
  `,
  overlayTitle: css`
    overflow: hidden;

    font-size: 13px;
    font-weight: 700;
    line-height: 1.2;
    color: #fff;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  `,
  overlayLine: css`
    overflow: hidden;

    font-size: 11px;
    line-height: 1.3;
    color: rgb(255 255 255 / 90%);
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  overlayFooter: css`
    display: flex;
    gap: 8px;
    align-items: flex-end;
    justify-content: space-between;
  `,
  /**
   * «Подробнее» — bottom-right of the hover layer. Hidden and inert until
   * the layer shows; without `pointer-events: none` the transparent hit
   * area still swallowed clicks meant for the card.
   */
  zoomBtn: css`
    pointer-events: none;
    cursor: pointer;

    display: flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;

    inline-size: 32px;
    block-size: 32px;
    border: none;
    border-radius: 8px;

    color: #fff;

    opacity: 0;
    background: rgb(255 255 255 / 18%);

    transition:
      opacity 0.18s ease,
      background 0.18s ease;

    &:hover {
      background: rgb(255 255 255 / 32%);
    }

    &:focus-visible {
      outline: 2px solid #fff;
      outline-offset: 1px;
    }
  `,
  /**
   * Mobile caption, under the media, in the page's own text colour. Exactly
   * `MOBILE_CAPTION_HEIGHT` (40px) tall — the masonry adds that constant to
   * each tile without measuring — so both lines are single-line ellipsised.
   */
  caption: css`
    display: flex;
    flex-direction: column;
    gap: 1px;
    justify-content: center;

    block-size: 40px;
    padding-inline: 8px;
  `,
  captionTitle: css`
    overflow: hidden;

    font-size: 12px;
    font-weight: 600;
    line-height: 15px;
    color: ${token.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  captionSub: css`
    overflow: hidden;

    font-size: 11px;
    line-height: 14px;
    color: ${token.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

const PresetCard = memo<Props>(
  ({ isActive, mediaAspectRatio, onClick, onPrefetch, onZoom, preset }) => {
    const { styles, cx } = useStyles();
    const { t } = useTranslation('common');
    const isMobile = useIsMobile();
    const [playing, setPlaying] = useState(false);

    // Ingested rows often have no description; the Russian category label is
    // still more use than a blank line, and it is never English.
    const subtitle = preset.description || categoryLabel(preset.category);
    const likes = preset.popularity === null ? null : `♥ ${compactCount.format(preset.popularity)}`;
    const badges = isMobile ? preset.badges.slice(0, 1) : preset.badges;
    const showPlayBadge = isVideoPreview(preset) && !playing;

    const prefetch = onPrefetch ? () => onPrefetch(preset) : undefined;

    const zoom = (e: { preventDefault: () => void; stopPropagation: () => void }) => {
      e.preventDefault();
      e.stopPropagation();
      onZoom?.(preset);
    };

    return (
      <button
        aria-label={preset.title}
        className={cx(styles.card, isMobile && styles.cardMobile, isActive && styles.active)}
        type="button"
        onClick={() => onClick(preset)}
        onFocus={prefetch}
        onPointerEnter={prefetch}
        onTouchStart={prefetch}
      >
        <div
          className={styles.media}
          style={{ aspectRatio: mediaAspectRatio ?? tileAspectRatio(preset) }}
        >
          <PresetMP4Player
            ariaHidden
            // Desktop plays on hover — that is a deliberate "show me this one".
            // Touch has no hover, so there the most-visible card plays instead.
            autoplayInView={isMobile}
            fallbackLabel={preset.title}
            posterUrl={preset.posterUrl ?? undefined}
            previewUrl={preset.previewUrl}
            onPlayingChange={setPlaying}
          />

          {(badges.length > 0 || preset.requiresImage) && (
            <div className={styles.badges}>
              {badges.map((b) => (
                <span
                  className={styles.badge}
                  key={b}
                  style={{
                    background: BADGE_COLORS[b],
                    color: b === 'top_choice' ? '#000' : undefined,
                  }}
                >
                  {BADGE_LABELS[b]}
                </span>
              ))}
              {/* i2v: the user must know before tapping that a photo is needed.
                  Short form on a phone so it fits a 140px tile beside one badge. */}
              {preset.requiresImage && <RequiresImageBadge short={isMobile} variant="overlay" />}
            </div>
          )}

          {showPlayBadge && (
            <span aria-hidden className={cx(styles.playBadge, isMobile && styles.playBadgeMobile)}>
              <Play fill="currentColor" size={12} strokeWidth={0} />
            </span>
          )}

          {!isMobile && (
            <div className={cx(styles.hoverOverlay, 'preset-hover-overlay')}>
              <div className={styles.overlayTitle}>{preset.title}</div>
              <div className={styles.overlayLine}>{subtitle}</div>
              <div className={styles.overlayFooter}>
                <span className={styles.overlayLine}>
                  {preset.authorName}
                  {preset.authorName && likes && ' · '}
                  {likes}
                </span>
                {onZoom && (
                  <span
                    aria-label={t('preset.details')}
                    className={cx(styles.zoomBtn, 'preset-zoom-btn')}
                    role="button"
                    tabIndex={0}
                    title={t('preset.details')}
                    onClick={zoom}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') zoom(e);
                    }}
                  >
                    <Maximize2 size={14} />
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {isMobile && (
          <div className={styles.caption}>
            <div className={styles.captionTitle}>{preset.title}</div>
            <div className={styles.captionSub}>
              {subtitle}
              {likes && ` · ${likes}`}
            </div>
          </div>
        )}
      </button>
    );
  },
);

PresetCard.displayName = 'PresetCard';

export default PresetCard;
