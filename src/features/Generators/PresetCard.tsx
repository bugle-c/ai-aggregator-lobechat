'use client';

import { createStyles } from 'antd-style';
import { ZoomIn } from 'lucide-react';
import { memo, useState } from 'react';

import type { Preset, PresetBadge } from '@/types/preset';

import PresetMP4Player from './PresetMP4Player';
import PresetZoomModal from './PresetZoomModal';

interface Props {
  isActive?: boolean;
  onClick: (preset: Preset) => void;
  preset: Preset;
}

const BADGE_LABELS: Record<PresetBadge, string> = {
  mixed: 'Mixed',
  new: 'New',
  top_choice: 'Top',
  trending: '🔥',
};

const BADGE_COLORS: Record<PresetBadge, string> = {
  mixed: 'rgba(120, 120, 120, 0.85)',
  new: '#dc2626',
  top_choice: '#facc15',
  trending: 'transparent',
};

/**
 * Category-keyed usage hint. Shown on hover overlay so the user
 * understands what to put in the prompt for this preset to "click".
 * Falls back to a generic line if a new category appears.
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

const useStyles = createStyles(({ css, token }) => ({
  card: css`
    cursor: pointer;

    position: relative;

    overflow: hidden;
    display: block;
    break-inside: avoid;

    width: 100%;
    margin-block: 0 12px;
    margin-inline: 0;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 12px;

    color: inherit;

    background: ${token.colorFillTertiary};

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
      opacity: 1;
    }
  `,
  active: css`
    border-color: ${token.colorPrimary};
    border-width: 2px;
  `,
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
  bottomLabel: css`
    pointer-events: none;

    position: absolute;
    inset-block-end: 0;
    inset-inline: 0;

    padding-block: 24px 10px;
    padding-inline: 12px;

    font-size: 13px;
    font-weight: 600;
    color: #fff;
    text-transform: uppercase;

    background: linear-gradient(180deg, transparent 0%, rgb(0 0 0 / 70%) 100%);

    transition: opacity 0.18s ease;
  `,
  zoomBtn: css`
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
}));

/**
 * Convert a `params_lock.aspect_ratio` string like "3:4" / "16:9" / "1:1"
 * into a CSS aspect-ratio value. Falls back to "3 / 4" for untagged
 * presets so the layout never collapses.
 */
const cardAspectRatio = (preset: Preset): string => {
  const raw = preset.paramsLock?.aspect_ratio;
  if (typeof raw === 'string') {
    const m = raw.match(/^(\d+)\s*[:×x/]\s*(\d+)$/);
    if (m) return `${m[1]} / ${m[2]}`;
  }
  return '3 / 4';
};

const PresetCard = memo<Props>(({ isActive, onClick, preset }) => {
  const { styles, cx } = useStyles();
  const hint = CATEGORY_HINTS[preset.category];
  const [zoomOpen, setZoomOpen] = useState(false);

  return (
    <>
      <button
        aria-label={preset.title}
        className={cx(styles.card, isActive && styles.active)}
        style={{ aspectRatio: cardAspectRatio(preset) }}
        type="button"
        onClick={() => onClick(preset)}
      >
        <PresetMP4Player ariaHidden fallbackLabel={preset.title} previewUrl={preset.previewUrl} />

        <span
          aria-label="Увеличить превью"
          className={cx(styles.zoomBtn, 'preset-zoom-btn')}
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setZoomOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              setZoomOpen(true);
            }
          }}
        >
          <ZoomIn size={16} />
        </span>

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

        <div className={styles.bottomLabel}>{preset.title}</div>

        <div className={cx(styles.hoverOverlay, 'preset-hover-overlay')}>
          <div className={styles.title}>{preset.title}</div>
          {preset.description && <div className={styles.description}>{preset.description}</div>}
          {hint && <div className={styles.hint}>{hint}</div>}
        </div>
      </button>
      <PresetZoomModal
        open={zoomOpen}
        preset={preset}
        onApply={() => onClick(preset)}
        onClose={() => setZoomOpen(false)}
      />
    </>
  );
});

PresetCard.displayName = 'PresetCard';

export default PresetCard;
