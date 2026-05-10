'use client';

import { Tabs } from 'antd';
import { memo } from 'react';

import PresetGallery from '@/features/Generators/PresetGallery';
import { useFlowUrlState } from '@/features/Generators/useFlowUrlState';
import { useVideoStore } from '@/store/video';
import { generationBatchSelectors } from '@/store/video/selectors';
import { presetSelectors } from '@/store/video/slices/preset/selectors';

import GenerationFeed from './GenerationFeed';

/**
 * Two-tab main area for the new video flow page.
 * Mirror of image/features/FlowMainArea.tsx — same UX, different store.
 */
const FlowMainArea = memo(() => {
  const hasGenerations = useVideoStore(generationBatchSelectors.hasAnyBatches);
  const selectPreset = useVideoStore((s) => s.selectPreset);
  const selectedSlug = useVideoStore(presetSelectors.presetSlug);

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
      onChange={(k) => url.setTab(k === 'presets' ? 'presets' : 'feed')}
    />
  );
});

FlowMainArea.displayName = 'VideoFlowMainArea';

export default FlowMainArea;
