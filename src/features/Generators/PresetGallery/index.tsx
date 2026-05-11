'use client';

import { Flexbox } from '@lobehub/ui';
import { Input } from 'antd';
import { Search } from 'lucide-react';
import { memo } from 'react';

import type { Preset, PresetModality } from '@/types/preset';

import CategoryTabs from './CategoryTabs';
import ModelTabs from './ModelTabs';
import PresetGrid from './PresetGrid';

interface Props {
  category: string | undefined;
  modality: PresetModality;
  modelId: string | undefined;
  onCategoryChange: (slug: string | undefined) => void;
  onModelChange: (modelId: string | undefined) => void;
  onPresetSelect: (preset: Preset) => void;
  onSearchChange: (q: string | undefined) => void;
  q: string | undefined;
  selectedSlug: string | null;
}

const PresetGallery = memo<Props>((props) => {
  return (
    <Flexbox flex={1} gap={8} style={{ overflowY: 'auto' }}>
      <ModelTabs
        modality={props.modality}
        selected={props.modelId}
        onSelect={props.onModelChange}
      />
      <Flexbox horizontal align="center" gap={8} paddingInline={16}>
        <Flexbox flex={1}>
          <CategoryTabs
            modality={props.modality}
            selected={props.category}
            onSelect={props.onCategoryChange}
          />
        </Flexbox>
        <Input
          allowClear
          placeholder="Поиск"
          prefix={<Search size={14} />}
          style={{ maxWidth: 200 }}
          value={props.q ?? ''}
          onChange={(e) => props.onSearchChange(e.target.value || undefined)}
        />
      </Flexbox>
      <PresetGrid
        category={props.category}
        modality={props.modality}
        q={props.q}
        recommendedModelId={props.modelId}
        selectedSlug={props.selectedSlug}
        onSelect={props.onPresetSelect}
      />
    </Flexbox>
  );
});

PresetGallery.displayName = 'PresetGallery';

export default PresetGallery;
