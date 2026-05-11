'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { Segmented } from 'antd';
import { ArrowLeft } from 'lucide-react';
import { memo } from 'react';
import { useNavigate } from 'react-router-dom';

import PresetGallery from '@/features/Generators/PresetGallery';
import { useFlowUrlState } from '@/features/Generators/useFlowUrlState';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useImageStore } from '@/store/image';
import { generationTopicSelectors } from '@/store/image/selectors';
import { presetSelectors } from '@/store/image/slices/preset/selectors';

import GenerationFeed from './GenerationFeed';

/**
 * Main area for the new image flow page.
 *
 * Header strip: ← Назад · Segmented [ Стили | Мои генерации ]
 * Body: matches the active segment — gallery or feed.
 *
 * Earlier this rendered antd `<Tabs/>`, which looked like a text label
 * with an underline — users didn't realize it was a toggle. `<Segmented/>`
 * gives a clear pill-shaped switch matching higgsfield's reference.
 */
const FlowMainArea = memo(() => {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const selectPreset = useImageStore((s) => s.selectPreset);
  const selectedSlug = useImageStore(presetSelectors.presetSlug);

  // Pull batches for the current topic — without this the feed tab
  // is empty even when prior generations exist.
  const activeTopicId = useImageStore(generationTopicSelectors.activeGenerationTopicId);
  const useFetchGenerationBatches = useImageStore((s) => s.useFetchGenerationBatches);
  useFetchGenerationBatches(activeTopicId);

  // Gallery is the primary surface — see history in previous commits
  // for why the previous "feed-when-has-generations" default was wrong.
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

FlowMainArea.displayName = 'ImageFlowMainArea';

export default FlowMainArea;
