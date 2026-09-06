'use client';

import { createStyles } from 'antd-style';
import { ZoomIn } from 'lucide-react';
import { memo } from 'react';

import { useIsMobile } from '@/hooks/useIsMobile';
import type { PresetBadge, PresetListItem } from '@/types/preset';

import { categoryLabel } from './PRESET_CATEGORIES';
import { cardMediaAspectRatio } from './presetAspect';
import PresetMP4Player from './PresetMP4Player';

interface Props {
  isActive?: boolean;
  /**
   * Overrides the per-modality default from `cardMediaAspectRatio`. The home
   * page keeps its video thumbnails portrait even though the gallery grid
   * shows video presets in 16:9.
   */
  mediaAspectRatio?: string;
  onClick: (preset: PresetListItem) => void;
  /**
   * Opens the details view for this preset. The modal itself lives one level
   * up (one instance for the whole list, not one per card — at ~1000 rows
   * a per-card modal meant ~1000 mounted antd dialogs). Omit to hide the
   * zoom affordance entirely.
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
 * Shown for any category we have no tailored hint for — the ingest cron can
 * introduce categories this map has never heard of, and a blank hint area
 * looked like a rendering bug.
 */
const GENERIC_HINT = 'Опишите, что показать — стиль возьмётся из пресета.';

/**
 * Category-keyed usage hint. Shown on hover overlay so the user
 * understands what to put in the prompt for this preset to "click".
 * Falls back to GENERIC_HINT if a new category appears.
 */
const CATEGORY_HINTS: Record<string, string> = {
  action: 'Кратко опишите героя/действие — стиль кадра уже зашит в пресет.',
  ambient: 'Опишите сцену или настроение — атмосфера применится сама.',
  anime: 'Опишите персонажа, эмоцию или сюжет.',
  artistic: 'Назовите тему — будет в выбранном арт-стиле.',
  camera: 'Кратко опишите главного героя/объект кадра.',
  character: 'Опишите внешность и эмоцию героя.',
  effects: 'Назовите объект — спецэффект применится поверх.',
  landscape: 'Опишите место, эпоху или время суток.',
  portrait: 'Загрузите ваше фото в стиле этого пресета.',
  product: 'Загрузите фото продукта или опишите его в одном предложении.',
  realistic: 'Опишите сцену; чем конкретнее детали — тем точнее результат.',
};

/**
 * "1,2 тыс." rather than "1200" — the number is a texture cue on a 140px
 * card, not a figure anyone reads digit by digit.
 */
const compactCount = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 1,
  notation: 'compact',
});

const useStyles = createStyles(({ css, token }) => ({
  card: css`
    cursor: pointer;

    overflow: hidden;
    display: flex;
    flex-direction: column;

    width: 100%;
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

    &:hover .preset-hover-overlay {
      opacity: 1;
    }

    &:hover .preset-zoom-btn {
      pointer-events: auto;
      opacity: 1;
    }
  `,
  /**
   * The media box. Every card in a grid shares one aspect ratio (see
   * `cardMediaAspectRatio`) and the preview is cover-cropped into it, so
   * rows stay flush and the captions below them line up.
   */
  media: css`
    position: relative;
    overflow: hidden;
    width: 100%;
    background: ${token.colorFillTertiary};
  `,
  /**
   * Always visible, below the media, in the page's own text colour.
   *
   * The title used to be the only permanent text and it sat in a gradient
   * over the preview; the Russian description and the category hint lived
   * exclusively in a `:hover` overlay, which touch devices never trigger.
   * Since legacy titles are English, a phone user saw an English word on a
   * picture and nothing else. Sized to stay legible on a ~140px-wide card
   * (two columns on a small phone).
   */
  caption: css`
    display: flex;
    flex-direction: column;
    gap: 2px;

    padding-block: 8px;
    padding-inline: 10px;
  `,
  captionTitle: css`
    overflow: hidden;

    font-size: 13px;
    font-weight: 600;
    line-height: 1.25;
    color: ${token.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  captionSub: css`
    overflow: hidden;

    font-size: 11px;
    line-height: 1.3;
    color: ${token.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  /** Author handle + popularity. Full credit lives in the zoom modal. */
  captionMeta: css`
    overflow: hidden;

    font-size: 11px;
    line-height: 1.3;
    color: ${token.colorTextQuaternary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  active: css`
    border-color: ${token.colorPrimary};
    border-width: 2px;
  `,
  /**
   * Desktop-only enrichment: the same facts as the caption plus the usage
   * hint, larger, over the preview. Hidden entirely where there is no
   * hover, so it can never be the only carrier of information.
   */
  hoverOverlay: css`
    pointer-events: none;

    position: absolute;
    inset: 0;

    display: flex;
    flex-direction: column;
    gap: 4px;
    justify-content: flex-end;

    padding: 12px;

    opacity: 0;
    background: linear-gradient(180deg, rgb(0 0 0 / 0%) 0%, rgb(0 0 0 / 80%) 60%);

    transition: opacity 0.18s ease;

    @media (hover: none) {
      display: none;
    }
  `,
  title: css`
    font-size: 13px;
    font-weight: 700;
    line-height: 1.2;
    color: #fff;
    text-shadow: 0 1px 2px rgb(0 0 0 / 60%);
    text-transform: uppercase;
  `,
  description: css`
    font-size: 11px;
    line-height: 1.3;
    color: rgb(255 255 255 / 90%);
  `,
  hint: css`
    margin-block-start: 2px;
    font-size: 11px;
    line-height: 1.3;
    color: rgb(255 255 255 / 75%);
  `,
  zoomBtn: css`
    /* Hidden until hover. Without pointer-events:none the fully
       transparent 28×28 hit area still swallowed taps on touch devices,
       opening the zoom modal instead of applying the preset. */
    pointer-events: none;
    cursor: pointer;

    position: absolute;
    z-index: 3;
    inset-block-start: 8px;
    inset-inline-end: 8px;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 28px;
    height: 28px;
    border: none;
    border-radius: 6px;

    color: #fff;

    opacity: 0;
    background: rgb(0 0 0 / 55%);
    backdrop-filter: blur(4px);

    transition:
      opacity 0.18s ease,
      background 0.18s ease;

    &:hover {
      background: rgb(0 0 0 / 80%);
    }
  `,
  /**
   * Touch devices have no hover, so the details entry point must be
   * permanently visible — semi-transparent so it stays unobtrusive over
   * the preview.
   */
  zoomBtnTouch: css`
    pointer-events: auto;
    opacity: 0.75;
  `,
}));

const PresetCard = memo<Props>(({ isActive, mediaAspectRatio, onClick, onZoom, preset }) => {
  const { styles, cx } = useStyles();
  const hint = CATEGORY_HINTS[preset.category] ?? GENERIC_HINT;
  const isMobile = useIsMobile();

  // Ingested rows often have no description; the Russian category label is
  // still more use than a blank line, and it is never English.
  const subtitle = preset.description || categoryLabel(preset.category);

  return (
    <button
      aria-label={preset.title}
      className={cx(styles.card, isActive && styles.active)}
      type="button"
      onClick={() => onClick(preset)}
    >
      <div
        className={styles.media}
        style={{ aspectRatio: mediaAspectRatio ?? cardMediaAspectRatio(preset.modality) }}
      >
        <PresetMP4Player
          ariaHidden
          // Desktop plays on hover — that is a deliberate "show me this one".
          // Touch has no hover, so there the most-visible card plays instead.
          autoplayInView={isMobile}
          fallbackLabel={preset.title}
          posterUrl={preset.posterUrl ?? undefined}
          previewUrl={preset.previewUrl}
        />

        {onZoom && (
          <span
            aria-label="Подробнее о стиле"
            className={cx(styles.zoomBtn, isMobile && styles.zoomBtnTouch, 'preset-zoom-btn')}
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onZoom(preset);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onZoom(preset);
              }
            }}
          >
            <ZoomIn size={16} />
          </span>
        )}

        {preset.badges.length > 0 && (
          <div
            style={{
              display: 'flex',
              gap: 4,
              insetBlockStart: 8,
              insetInlineStart: 8,
              pointerEvents: 'none',
              position: 'absolute',
            }}
          >
            {preset.badges.map((b) => (
              <span
                key={b}
                style={{
                  background: BADGE_COLORS[b],
                  borderRadius: 6,
                  color: b === 'top_choice' ? '#000' : '#fff',
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '2px 6px',
                }}
              >
                {BADGE_LABELS[b]}
              </span>
            ))}
          </div>
        )}

        <div className={cx(styles.hoverOverlay, 'preset-hover-overlay')}>
          <div className={styles.title}>{preset.title}</div>
          {preset.description && <div className={styles.description}>{preset.description}</div>}
          {hint && <div className={styles.hint}>{hint}</div>}
        </div>
      </div>

      <div className={styles.caption}>
        <div className={styles.captionTitle}>{preset.title}</div>
        <div className={styles.captionSub}>{subtitle}</div>
        {(preset.authorName || preset.popularity !== null) && (
          <div className={styles.captionMeta}>
            {preset.authorName}
            {preset.authorName && preset.popularity !== null && ' · '}
            {preset.popularity !== null && `♥ ${compactCount.format(preset.popularity)}`}
          </div>
        )}
      </div>
    </button>
  );
});

PresetCard.displayName = 'PresetCard';

export default PresetCard;
