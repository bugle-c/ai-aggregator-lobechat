'use client';

import { Flexbox } from '@lobehub/ui';
import { useDebounceFn } from 'ahooks';
import { Input } from 'antd';
import { Search } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { PresetListItem, PresetModality } from '@/types/preset';

import CategoryTabs from './CategoryTabs';
import ModelTabs from './ModelTabs';
import PresetGrid from './PresetGrid';

/** Search is a leading-wildcard scan over four columns — don't fire per keystroke. */
const SEARCH_DEBOUNCE_MS = 300;

interface Props {
  category: string | undefined;
  modality: PresetModality;
  modelId: string | undefined;
  onCategoryChange: (slug: string | undefined) => void;
  onModelChange: (modelId: string | undefined) => void;
  onPresetSelect: (preset: PresetListItem) => void;
  onSearchChange: (q: string | undefined) => void;
  q: string | undefined;
  selectedSlug: string | null;
}

const PresetGallery = memo<Props>((props) => {
  const { onCategoryChange, onModelChange, onSearchChange, q } = props;
  const { t } = useTranslation('common');

  // The input is driven locally so typing stays instant; the debounced push is
  // what reaches the URL and the query. `q` is only read for the initial value
  // — the gallery writes it with `replace: true`, so it never changes
  // underneath us except through `resetFilters` below, which clears both.
  const [text, setText] = useState(q ?? '');

  const { cancel: cancelSearch, run: pushSearch } = useDebounceFn(
    (value: string) => onSearchChange(value || undefined),
    { wait: SEARCH_DEBOUNCE_MS },
  );

  const hasFilters = !!props.category || !!props.modelId || !!q;

  const resetFilters = useCallback(() => {
    // Drop any keystroke still waiting in the debounce window, otherwise it
    // would re-apply the search a moment after the reset.
    cancelSearch();
    setText('');
    onCategoryChange(undefined);
    onModelChange(undefined);
    onSearchChange(undefined);
  }, [cancelSearch, onCategoryChange, onModelChange, onSearchChange]);

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
          placeholder={t('preset.searchPlaceholder')}
          prefix={<Search size={14} />}
          style={{ maxWidth: 200 }}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            pushSearch(e.target.value);
          }}
        />
      </Flexbox>
      <PresetGrid
        category={props.category}
        hasFilters={hasFilters}
        modality={props.modality}
        q={props.q}
        recommendedModelId={props.modelId}
        selectedSlug={props.selectedSlug}
        onResetFilters={resetFilters}
        onSelect={props.onPresetSelect}
      />
    </Flexbox>
  );
});

PresetGallery.displayName = 'PresetGallery';

export default PresetGallery;
