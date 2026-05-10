'use client';

import { Tabs } from 'antd';
import { memo } from 'react';

import PresetGallery from '@/features/Generators/PresetGallery';
import { useFlowUrlState } from '@/features/Generators/useFlowUrlState';
import { useImageStore } from '@/store/image';
import { generationBatchSelectors } from '@/store/image/selectors';
import { presetSelectors } from '@/store/image/slices/preset/selectors';

import GenerationFeed from './GenerationFeed';

/**
 * Two-tab main area for the new image flow page.
 *
 * - "Стили" — preset gallery (model tabs, category tabs, search, grid)
 * - "Мои генерации" — existing GenerationFeed (unchanged)
 *
 * Default tab depends on whether the user has any prior generations.
 */
const FlowMainArea = memo(() => {
  const hasGenerations = useImageStore(generationBatchSelectors.hasAnyBatches);
  const selectPreset = useImageStore((s) => s.selectPreset);
  const selectedSlug = useImageStore(presetSelectors.presetSlug);

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
              modality="image"
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

FlowMainArea.displayName = 'ImageFlowMainArea';

export default FlowMainArea;
