'use client';

import { Tabs } from 'antd';
import { memo, useMemo } from 'react';

import { lambdaQuery } from '@/libs/trpc/client';
import type { PresetModality } from '@/types/preset';

import { ALL_CATEGORIES_KEY, categoryLabel } from '../PRESET_CATEGORIES';

interface Props {
  modality: PresetModality;
  onSelect: (slug: string | undefined) => void;
  /** undefined or '__all' = no category filter */
  selected: string | undefined;
}

/**
 * Category strip built from `presets.facets`, i.e. from the categories that
 * actually exist in the DB for this modality. The previous hardcoded list left
 * ingested categories unreachable — there was no tab that could select them.
 */
const CategoryTabs = memo<Props>(({ modality, onSelect, selected }) => {
  const { data } = lambdaQuery.presets.facets.useQuery({ modality }, { staleTime: 5 * 60 * 1000 });

  const items = useMemo(() => {
    const tabs = [{ key: ALL_CATEGORIES_KEY, label: 'Все' }];
    for (const f of data?.categories ?? [])
      tabs.push({ key: f.category, label: categoryLabel(f.category) });
    return tabs;
  }, [data]);

  return (
    <Tabs
      activeKey={selected ?? ALL_CATEGORIES_KEY}
      items={items}
      size="small"
      onChange={(key) => onSelect(key === ALL_CATEGORIES_KEY ? undefined : key)}
    />
  );
});

CategoryTabs.displayName = 'PresetCategoryTabs';

export default CategoryTabs;
