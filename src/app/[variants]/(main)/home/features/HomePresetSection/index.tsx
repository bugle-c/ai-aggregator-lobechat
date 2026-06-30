'use client';

import { Flexbox } from '@lobehub/ui';
import { Skeleton } from 'antd';
import { ArrowRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import PresetCard from '@/features/Generators/PresetCard';
import { useIsMobile } from '@/hooks/useIsMobile';
import { lambdaQuery } from '@/libs/trpc/client';
import { useHomeStore } from '@/store/home';
import type { PresetModality } from '@/types/preset';

interface Props {
  /** How many presets to show in the single row. */
  limit?: number;
  modality: PresetModality;
}

/**
 * Compact "home variant" of the IMAGE preset gallery: a single, non-wrapping
 * row of the top-N presets with an "Все →" link to the full /image page.
 *
 * Layout: one row of 5 columns on desktop. On mobile it becomes a
 * horizontally-scrollable strip (each card keeps a fixed width so the row
 * never collapses). Reuses the shared <PresetCard/> for thumbnails + zoom +
 * badges.
 *
 * NOTE: video uses its own <HomeVideoSection/> (grid row + featured slider),
 * this component is image-only now.
 */
const HomePresetSection = memo<Props>(({ limit = 5, modality }) => {
  const { t } = useTranslation('home');
  const isMobile = useIsMobile();
  const navigate = useHomeStore((s) => s.navigate);

  const targetPath = modality === 'image' ? '/image' : '/video';

  const { data, isLoading } = lambdaQuery.presets.list.useQuery(
    { modality },
    { staleTime: 5 * 60 * 1000 },
  );

  // Self-hide when there are genuinely no presets for this modality.
  if (!isLoading && (!data || data.length === 0)) return null;

  const presets = (data ?? []).slice(0, limit);

  // Each cell: equal-width flex column on desktop; fixed-width scroll item on
  // mobile so the 5 cards stay on one line instead of wrapping into a stack.
  const cellStyle = {
    flex: isMobile ? '0 0 140px' : '1 1 0',
    minWidth: isMobile ? 140 : 0,
  } as const;

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal align="center" justify="space-between" paddingInline={16}>
        <span style={{ fontSize: 18, fontWeight: 600 }}>{t('presets.imageTitle')}</span>
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
            navigate?.(targetPath);
          }}
        >
          {t('presets.allImages')}
          <ArrowRight size={14} />
        </a>
      </Flexbox>

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
          ? Array.from({ length: limit }).map((_, i) => (
              <div key={`preset-skeleton-${i}`} style={cellStyle}>
                <Skeleton.Node
                  active
                  style={{ aspectRatio: '3 / 4', height: 'auto', width: '100%' }}
                />
              </div>
            ))
          : presets.map((p) => (
              <div key={p.slug} style={cellStyle}>
                <PresetCard
                  preset={p}
                  onClick={() => navigate?.(`${targetPath}?preset=${encodeURIComponent(p.slug)}`)}
                />
              </div>
            ))}
      </div>
    </Flexbox>
  );
});

HomePresetSection.displayName = 'HomePresetSection';

export default HomePresetSection;
