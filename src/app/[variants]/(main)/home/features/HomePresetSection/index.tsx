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
  /** How many presets to show on the home teaser. */
  limit?: number;
  modality: PresetModality;
}

/**
 * Compact "home variant" of the preset gallery: shows the top-N presets
 * for a modality with an "Все →" link to the full /image or /video page.
 *
 * Reuses the shared <PresetCard/> (same thumbnails + zoom + badges as the
 * full gallery) but skips the model/category/search filter chrome — the
 * home page is a teaser, not the full picker. Clicking a card routes to
 * the full flow page with ?preset=<slug> so the user lands on the chosen
 * style ready to generate.
 */
const HomePresetSection = memo<Props>(({ limit = 8, modality }) => {
  const { t } = useTranslation('home');
  const isMobile = useIsMobile();
  const navigate = useHomeStore((s) => s.navigate);

  const targetPath = modality === 'image' ? '/image' : '/video';

  // Same query the full gallery uses (presets.list), unfiltered. Server
  // returns them sorted by sortOrder, so slicing top-N gives the curated
  // "featured" set without extra params.
  const { data, isLoading } = lambdaQuery.presets.list.useQuery(
    { modality },
    { staleTime: 5 * 60 * 1000 },
  );

  // Self-hide when there are genuinely no presets for this modality.
  if (!isLoading && (!data || data.length === 0)) return null;

  const presets = (data ?? []).slice(0, limit);

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal align="center" justify="space-between" paddingInline={16}>
        <span style={{ fontSize: 18, fontWeight: 600 }}>
          {modality === 'image' ? t('presets.imageTitle') : t('presets.videoTitle')}
        </span>
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
          {modality === 'image' ? t('presets.allImages') : t('presets.allVideos')}
          <ArrowRight size={14} />
        </a>
      </Flexbox>

      <div
        style={{
          columnCount: isMobile ? 2 : 4,
          columnGap: 12,
          paddingInline: 16,
        }}
      >
        {isLoading
          ? Array.from({ length: limit }).map((_, i) => (
              <Skeleton.Node
                active
                key={`preset-skeleton-${i}`}
                style={{ aspectRatio: '3 / 4', height: 'auto', marginBlockEnd: 12, width: '100%' }}
              />
            ))
          : presets.map((p) => (
              <PresetCard
                key={p.slug}
                preset={p}
                onClick={() => navigate?.(`${targetPath}?preset=${encodeURIComponent(p.slug)}`)}
              />
            ))}
      </div>
    </Flexbox>
  );
});

HomePresetSection.displayName = 'HomePresetSection';

export default HomePresetSection;
