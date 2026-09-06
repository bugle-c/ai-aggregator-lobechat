'use client';

import { Flexbox } from '@lobehub/ui';
import { useDebounceFn } from 'ahooks';
import { memo, useCallback, useState } from 'react';

import type { PresetListItem, PresetModality, PresetSort } from '@/types/preset';

import PresetGrid from './PresetGrid';
import Toolbar from './Toolbar';

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
  /** Hover / first-touch on a card — warm what selecting it will need. */
  onPresetPrefetch?: (preset: PresetListItem) => void;
  onPresetSelect: (preset: PresetListItem) => void;
  onSearchChange: (q: string | undefined) => void;
  q: string | undefined;
  selectedSlug: string | null;
}

/**
 * State orchestrator for the gallery: owns the live search text and its
 * debounce, the sort preference and the filter reset. Layout lives in
 * `Toolbar` (sticky browse controls) and `PresetGrid` (masonry + paging).
 */
const PresetGallery = memo<Props>((props) => {
  const { onCategoryChange, onModelChange, onSearchChange, q } = props;

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

  const handleTextChange = useCallback(
    (value: string) => {
      setText(value);
      if (value === '') {
        // Clearing should be immediate, not 300ms later.
        cancelSearch();
        onSearchChange(undefined);
      } else {
        pushSearch(value);
      }
    },
    [cancelSearch, onSearchChange, pushSearch],
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
      <Toolbar
        category={props.category}
        modality={props.modality}
        modelId={props.modelId}
        sort={sort}
        text={text}
        onCategoryChange={props.onCategoryChange}
        onModelChange={props.onModelChange}
        onSortChange={setSort}
        onTextChange={handleTextChange}
      />
      <PresetGrid
        category={props.category}
        hasFilters={hasFilters}
        modality={props.modality}
        q={props.q}
        recommendedModelId={props.modelId}
        selectedSlug={props.selectedSlug}
        sort={sort}
        onPrefetch={props.onPresetPrefetch}
        onResetFilters={resetFilters}
        onSelect={props.onPresetSelect}
      />
    </Flexbox>
  );
});

PresetGallery.displayName = 'PresetGallery';

export default PresetGallery;
