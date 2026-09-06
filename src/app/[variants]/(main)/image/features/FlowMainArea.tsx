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
import { usePresetModelSwitch } from '@/features/Generators/usePresetModelSwitch';
import ResourceExplorer from '@/features/ResourceManager/components/Explorer';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useImageStore } from '@/store/image';
import { generationTopicSelectors } from '@/store/image/selectors';
import { presetSelectors } from '@/store/image/slices/preset/selectors';
import { FilesTabs } from '@/types/files';

// GenerationFeed is intentionally not used — see embedded ResourceExplorer.

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

  // Gallery cards carry a slim `PresetListItem` (no prompt_template), so the
  // click path fetches the full preset before handing it to selectPreset.
  const hydratePreset = usePresetHydrate();

  // The style brings its model: after the store has the preset, the UI
  // layer switches to `recommendedModelId` (toast + «Вернуть»), or shows
  // the tier upsell when that model is locked. Silent for deep links.
  const { applyPresetModel, prefetchLock, upsellNode } = usePresetModelSwitch('image');

  // Home-page cards link here as /image?preset=<slug>; resolve that slug
  // into the actual selected preset.
  usePresetDeepLink({
    currentSlug: selectedSlug,
    modality: 'image',
    onApplied: (full) => void applyPresetModel(full, { silent: true }),
    selectPreset,
    slug: url.preset,
  });

  // Prime the resource-manager store to "images" so the embedded
  // <ResourceExplorer/> below shows the user's image gallery, not
  // every file they ever uploaded. Without this the embedded gallery
  // would default to FilesTabs.All.
  const setCategory = useResourceManagerStore((s) => s.setCategory);
  useEffect(() => {
    if (url.tab === 'feed') setCategory(FilesTabs.Images);
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
            modality="image"
            modelId={url.modelId}
            q={url.q}
            selectedSlug={selectedSlug}
            onCategoryChange={url.setCategory}
            onModelChange={url.setModel}
            onPresetPrefetch={(p) => prefetchLock(p.recommendedModelId)}
            onSearchChange={url.setQ}
            onPresetSelect={(p) => {
              url.setPreset(p.slug);
              void hydratePreset(p.slug).then((full) => {
                if (!full) return;
                selectPreset(full);
                void applyPresetModel(full);
              });
              if (isMobile) url.setView('create');
            }}
          />
        ) : (
          // Embed the resource gallery so "Мои генерации" stays on
          // the same page as the creation surface — the user no
          // longer has to bounce to /resource and back to keep
          // generating. ActiveGenerationsStrip inside Explorer adds
          // the skeleton placeholder while a generation is in flight.
          <ResourceExplorer />
        )}
      </Flexbox>
      {upsellNode}
    </Flexbox>
  );
});

FlowMainArea.displayName = 'ImageFlowMainArea';

export default FlowMainArea;
