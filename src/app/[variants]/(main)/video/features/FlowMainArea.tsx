'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { Segmented } from 'antd';
import { ArrowLeft } from 'lucide-react';
import { memo } from 'react';
import { useNavigate } from 'react-router-dom';

import PresetGallery from '@/features/Generators/PresetGallery';
import { useFlowUrlState } from '@/features/Generators/useFlowUrlState';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useVideoStore } from '@/store/video';
import { videoGenerationTopicSelectors } from '@/store/video/selectors';
import { presetSelectors } from '@/store/video/slices/preset/selectors';

import GenerationFeed from './GenerationFeed';

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
          size="normal"
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
              selectPreset(p);
              url.setPreset(p.slug);
              if (isMobile) url.setView('create');
            }}
          />
        ) : (
          <GenerationFeed />
        )}
      </Flexbox>
    </Flexbox>
  );
});

FlowMainArea.displayName = 'VideoFlowMainArea';

export default FlowMainArea;
