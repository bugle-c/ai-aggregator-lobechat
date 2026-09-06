'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { Segmented } from 'antd';
import { ArrowLeft } from 'lucide-react';
import { memo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { useResourceManagerStore } from '@/app/[variants]/(main)/resource/features/store';
import PresetGallery from '@/features/Generators/PresetGallery';
import { useFlowUrlState } from '@/features/Generators/useFlowUrlState';
import { usePresetDeepLink } from '@/features/Generators/usePresetDeepLink';
import { usePresetHydrate } from '@/features/Generators/usePresetHydrate';
import ResourceExplorer from '@/features/ResourceManager/components/Explorer';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useVideoStore } from '@/store/video';
import { videoGenerationTopicSelectors } from '@/store/video/selectors';
import { presetSelectors } from '@/store/video/slices/preset/selectors';
import { FilesTabs } from '@/types/files';

/**
 * Main area for the new video flow page.
 * Mirror of image/features/FlowMainArea — Segmented switch
 * Стили / Мои генерации with a leading back arrow.
 */
const FlowMainArea = memo(() => {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const selectPreset = useVideoStore((s) => s.selectPreset);
  const selectedSlug = useVideoStore(presetSelectors.presetSlug);

  const activeTopicId = useVideoStore(videoGenerationTopicSelectors.activeGenerationTopicId);
  const useFetchGenerationBatches = useVideoStore((s) => s.useFetchGenerationBatches);
  useFetchGenerationBatches(activeTopicId);

  const url = useFlowUrlState('presets');

  // Gallery cards carry a slim `PresetListItem` (no prompt_template), so the
  // click path fetches the full preset before handing it to selectPreset.
  const hydratePreset = usePresetHydrate();

  // Home-page cards link here as /video?preset=<slug>; resolve that slug
  // into the actual selected preset.
  usePresetDeepLink({
    currentSlug: selectedSlug,
    modality: 'video',
    selectPreset,
    slug: url.preset,
  });

  const setCategory = useResourceManagerStore((s) => s.setCategory);
  useEffect(() => {
    if (url.tab === 'feed') setCategory(FilesTabs.Videos);
  }, [url.tab, setCategory]);

  return (
    <Flexbox flex={1} gap={12} height={'100%'} style={{ overflow: 'hidden' }}>
      <Flexbox
        horizontal
        align="center"
        gap={12}
        paddingBlock={8}
        paddingInline={16}
        style={{ borderBlockEnd: '1px solid var(--ant-color-border-secondary)' }}
      >
        <ActionIcon
          aria-label="Назад"
          icon={ArrowLeft}
          size="small"
          onClick={() => navigate('/')}
        />
        <Segmented
          size="large"
          value={url.tab}
          options={[
            { label: 'Стили', value: 'presets' },
            { label: 'Мои генерации', value: 'feed' },
          ]}
          onChange={(k) => url.setTab(k === 'presets' ? 'presets' : 'feed')}
        />
      </Flexbox>

      <Flexbox flex={1} style={{ overflowY: 'auto' }}>
        {url.tab === 'presets' ? (
          <PresetGallery
            category={url.category}
            modality="video"
            modelId={url.modelId}
            q={url.q}
            selectedSlug={selectedSlug}
            onCategoryChange={url.setCategory}
            onModelChange={url.setModel}
            onSearchChange={url.setQ}
            onPresetSelect={(p) => {
              url.setPreset(p.slug);
              void hydratePreset(p.slug).then((full) => {
                if (full) selectPreset(full);
              });
              if (isMobile) url.setView('create');
            }}
          />
        ) : (
          <ResourceExplorer />
        )}
      </Flexbox>
    </Flexbox>
  );
});

FlowMainArea.displayName = 'VideoFlowMainArea';

export default FlowMainArea;
