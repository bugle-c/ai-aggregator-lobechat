'use client';

import { Flexbox } from '@lobehub/ui';
import { Skeleton } from 'antd';
import { createStyles } from 'antd-style';
import { ArrowRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import PresetCard from '@/features/Generators/PresetCard';
import PresetMP4Player from '@/features/Generators/PresetMP4Player';
import { useIsMobile } from '@/hooks/useIsMobile';
import { lambdaQuery } from '@/libs/trpc/client';
import { useHomeStore } from '@/store/home';
import type { Preset } from '@/types/preset';

const useStyles = createStyles(({ css, token }) => ({
  featuredCard: css`
    cursor: pointer;

    position: relative;

    overflow: hidden;

    /* width = one column of the 4-grid above; height = 16:9 landscape,
       which reads as ~2 grid-rows tall against the portrait thumbnails. */
    flex: 0 0 auto;
    width: clamp(280px, 46%, 520px);
    aspect-ratio: 16 / 9;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 14px;

    background: ${token.colorFillTertiary};

    transition:
      transform 0.18s ease,
      border-color 0.18s ease;

    &:hover {
      transform: translateY(-2px);
      border-color: ${token.colorPrimaryBorderHover};
    }
  `,
  featuredLabel: css`
    pointer-events: none;

    position: absolute;
    inset-block-end: 0;
    inset-inline: 0;

    padding-block: 28px 12px;
    padding-inline: 14px;

    font-size: 15px;
    font-weight: 600;
    color: #fff;
    text-shadow: 0 1px 3px rgb(0 0 0 / 60%);

    background: linear-gradient(180deg, transparent 0%, rgb(0 0 0 / 70%) 100%);
  `,
  slider: css`
    scrollbar-width: thin;

    display: flex;
    gap: 14px;

    overflow-x: auto;

    padding-block-end: 4px;
    padding-inline: 16px;

    -webkit-overflow-scrolling: touch;
    scroll-snap-type: x mandatory;

    > * {
      scroll-snap-align: start;
    }
  `,
}));

/**
 * VIDEO home section, two parts:
 *   1. a top row of up to 4 portrait preset thumbnails (reuses PresetCard);
 *   2. below it, a horizontally-scrollable slider of LARGE 16:9 landscape
 *      video previews (the "featured" set), each ~one grid-column wide but
 *      ~2 rows tall, played via PresetMP4Player (lazy, muted, looping).
 *
 * Data: one `presets.list({modality:'video'})` call. The top items become
 * the featured slider; the next 4 fill the thumbnail row.
 */
const HomeVideoSection = memo(() => {
  const { t } = useTranslation('home');
  const { styles } = useStyles();
  const isMobile = useIsMobile();
  const navigate = useHomeStore((s) => s.navigate);

  const { data, isLoading } = lambdaQuery.presets.list.useQuery(
    { modality: 'video' },
    { staleTime: 5 * 60 * 1000 },
  );

  if (!isLoading && (!data || data.length === 0)) return null;

  const all = data ?? [];
  // Featured slider gets the top items; thumbnail row gets the next 4. If
  // there are few presets, fall back to showing what we have in the row.
  const featuredCount = Math.min(4, all.length);
  const featured = all.slice(0, featuredCount);
  const thumbs = all.slice(featuredCount, featuredCount + 4);

  const goPreset = (p: Preset) =>
    navigate?.(`/video?preset=${encodeURIComponent(p.slug)}`);

  const thumbCellStyle = {
    flex: isMobile ? '0 0 140px' : '1 1 0',
    minWidth: isMobile ? 140 : 0,
  } as const;

  return (
    <Flexbox gap={16}>
      <Flexbox horizontal align="center" justify="space-between" paddingInline={16}>
        <span style={{ fontSize: 18, fontWeight: 600 }}>{t('presets.videoTitle')}</span>
        <a
          style={{
            alignItems: 'center',
            color: 'var(--ant-color-text-secondary)',
            display: 'inline-flex',
            fontSize: 14,
            gap: 4,
          }}
          onClick={(e) => {
            e.preventDefault();
            navigate?.('/video');
          }}
        >
          {t('presets.allVideos')}
          <ArrowRight size={14} />
        </a>
      </Flexbox>

      {/* Part 1: top row of up to 4 portrait thumbnails. */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          overflowX: isMobile ? 'auto' : 'visible',
          paddingBlockEnd: isMobile ? 4 : 0,
          paddingInline: 16,
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={`vthumb-skeleton-${i}`} style={thumbCellStyle}>
                <Skeleton.Node
                  active
                  style={{ aspectRatio: '3 / 4', height: 'auto', width: '100%' }}
                />
              </div>
            ))
          : thumbs.map((p) => (
              <div key={p.slug} style={thumbCellStyle}>
                <PresetCard preset={p} onClick={() => goPreset(p)} />
              </div>
            ))}
      </div>

      {/* Part 2: featured big-landscape (16:9) horizontal slider. */}
      <div className={styles.slider}>
        {isLoading
          ? Array.from({ length: 3 }).map((_, i) => (
              <Skeleton.Node
                active
                key={`vfeatured-skeleton-${i}`}
                style={{
                  aspectRatio: '16 / 9',
                  borderRadius: 14,
                  height: 'auto',
                  width: 'clamp(280px, 46%, 520px)',
                }}
              />
            ))
          : featured.map((p) => (
              <button
                aria-label={p.title}
                className={styles.featuredCard}
                key={p.slug}
                type="button"
                onClick={() => goPreset(p)}
              >
                <PresetMP4Player ariaHidden fallbackLabel={p.title} previewUrl={p.previewUrl} />
                <div className={styles.featuredLabel}>{p.title}</div>
              </button>
            ))}
      </div>
    </Flexbox>
  );
});

HomeVideoSection.displayName = 'HomeVideoSection';

export default HomeVideoSection;
