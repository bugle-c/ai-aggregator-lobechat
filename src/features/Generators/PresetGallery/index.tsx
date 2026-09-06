'use client';

import { Flexbox } from '@lobehub/ui';
import { useDebounceFn } from 'ahooks';
import { Input } from 'antd';
import { Search } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsMobile } from '@/hooks/useIsMobile';
import type { PresetListItem, PresetModality, PresetSort } from '@/types/preset';

import CategoryChips from './CategoryChips';
import ModelFilter from './ModelFilter';
import PresetGrid from './PresetGrid';
import SortSwitcher from './SortSwitcher';

/** Search is a leading-wildcard scan over four columns — don't fire per keystroke. */
const SEARCH_DEBOUNCE_MS = 300;

/** Matches the server default: a hand-curated order is the honest first impression. */
const DEFAULT_SORT: PresetSort = 'curated';

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
  const isMobile = useIsMobile();

  // The input is driven locally so typing stays instant; the debounced push is
  // what reaches the URL and the query. `q` is only read for the initial value
  // — the gallery writes it with `replace: true`, so it never changes
  // underneath us except through `resetFilters` below, which clears both.
  const [text, setText] = useState(q ?? '');

  // Ordering is a view preference, not a filter: it stays out of the URL and
  // out of `hasFilters`, and «Сбросить фильтры» leaves it alone.
  const [sort, setSort] = useState<PresetSort>(DEFAULT_SORT);

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
      {/* Explicit rows rather than one wrapping row: on a phone the wrap
          points are what decide whether the sort switcher lands next to the
          search box or under it, and that should not be luck. */}
      <Flexbox gap={8} paddingBlock={8} paddingInline={16}>
        <Flexbox horizontal align="center" gap={8}>
          <Input
            allowClear
            placeholder={t('preset.searchPlaceholder')}
            prefix={<Search size={14} />}
            size="large"
            style={{ flex: 1, minWidth: 0 }}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              pushSearch(e.target.value);
            }}
          />
          <ModelFilter
            modality={props.modality}
            selected={props.modelId}
            onSelect={props.onModelChange}
          />
        </Flexbox>
        <SortSwitcher block={isMobile} value={sort} onChange={setSort} />
        <CategoryChips
          modality={props.modality}
          selected={props.category}
          onSelect={props.onCategoryChange}
        />
      </Flexbox>
      <PresetGrid
        category={props.category}
        hasFilters={hasFilters}
        modality={props.modality}
        q={props.q}
        recommendedModelId={props.modelId}
        selectedSlug={props.selectedSlug}
        sort={sort}
        onResetFilters={resetFilters}
        onSelect={props.onPresetSelect}
      />
    </Flexbox>
  );
});

PresetGallery.displayName = 'PresetGallery';

export default PresetGallery;
