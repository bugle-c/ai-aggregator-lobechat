'use client';

import { ActionIcon } from '@lobehub/ui';
import { Tabs } from 'antd';
import { ArrowLeft } from 'lucide-react';
import { memo } from 'react';
import { useNavigate } from 'react-router-dom';

import PresetGallery from '@/features/Generators/PresetGallery';
import { useFlowUrlState } from '@/features/Generators/useFlowUrlState';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useImageStore } from '@/store/image';
import { generationBatchSelectors, generationTopicSelectors } from '@/store/image/selectors';
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
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const hasGenerations = useImageStore(generationBatchSelectors.hasAnyBatches);
  const selectPreset = useImageStore((s) => s.selectPreset);
  const selectedSlug = useImageStore(presetSelectors.presetSlug);

  // Pull batches for the current topic — without this the feed tab
  // is empty even when prior generations exist.
  const activeTopicId = useImageStore(generationTopicSelectors.activeGenerationTopicId);
  const useFetchGenerationBatches = useImageStore((s) => s.useFetchGenerationBatches);
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
                // On mobile, navigate to a full-screen creation view
                // (matches higgsfield: gallery → /flow/<modality>/prompt).
                // On desktop the sidebar is always visible so no nav.
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

FlowMainArea.displayName = 'ImageFlowMainArea';

export default FlowMainArea;
