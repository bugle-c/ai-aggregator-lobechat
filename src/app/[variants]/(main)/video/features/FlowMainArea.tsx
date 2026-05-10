'use client';

import { ActionIcon } from '@lobehub/ui';
import { Tabs } from 'antd';
import { ArrowLeft } from 'lucide-react';
import { memo } from 'react';
import { useNavigate } from 'react-router-dom';

import PresetGallery from '@/features/Generators/PresetGallery';
import { useFlowUrlState } from '@/features/Generators/useFlowUrlState';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useVideoStore } from '@/store/video';
import { generationBatchSelectors, videoGenerationTopicSelectors } from '@/store/video/selectors';
import { presetSelectors } from '@/store/video/slices/preset/selectors';

import GenerationFeed from './GenerationFeed';

/**
 * Two-tab main area for the new video flow page.
 * Mirror of image/features/FlowMainArea.tsx — same UX, different store.
 */
const FlowMainArea = memo(() => {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const hasGenerations = useVideoStore(generationBatchSelectors.hasAnyBatches);
  const selectPreset = useVideoStore((s) => s.selectPreset);
  const selectedSlug = useVideoStore(presetSelectors.presetSlug);

  // Pull batches for the current topic — without this the feed tab
  // is empty even when prior generations exist.
  const activeTopicId = useVideoStore(videoGenerationTopicSelectors.activeGenerationTopicId);
  const useFetchGenerationBatches = useVideoStore((s) => s.useFetchGenerationBatches);
  useFetchGenerationBatches(activeTopicId);

  const url = useFlowUrlState(hasGenerations ? 'feed' : 'presets');

  return (
    <Tabs
      activeKey={url.tab}
      style={{ height: '100%' }}
      items={[
        {
          children: (
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
                selectPreset(p);
                url.setPreset(p.slug);
                // On mobile, navigate to a full-screen creation view
                // (matches higgsfield gallery → creation flow).
                if (isMobile) url.setView('create');
              }}
            />
          ),
          key: 'presets',
          label: 'Стили',
        },
        {
          children: <GenerationFeed />,
          key: 'feed',
          label: 'Мои генерации',
        },
      ]}
      tabBarExtraContent={{
        left: (
          <ActionIcon
            aria-label="Назад"
            icon={ArrowLeft}
            size="normal"
            style={{ marginInlineEnd: 8 }}
            onClick={() => navigate('/')}
          />
        ),
      }}
      onChange={(k) => url.setTab(k === 'presets' ? 'presets' : 'feed')}
    />
  );
});

FlowMainArea.displayName = 'VideoFlowMainArea';

export default FlowMainArea;
