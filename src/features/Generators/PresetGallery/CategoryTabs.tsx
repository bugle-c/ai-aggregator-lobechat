'use client';

import { Tabs } from 'antd';
import { memo } from 'react';

import type { PresetModality } from '@/types/preset';

import { getCategories } from '../PRESET_CATEGORIES';

interface Props {
  modality: PresetModality;
  onSelect: (slug: string | undefined) => void;
  /** undefined or '__all' = no category filter */
  selected: string | undefined;
}

const CategoryTabs = memo<Props>(({ modality, onSelect, selected }) => {
  const cats = getCategories(modality);

  return (
    <Tabs
      activeKey={selected ?? '__all'}
      items={cats.map((c) => ({ key: c.slug, label: c.label }))}
      size="small"
      onChange={(key) => onSelect(key === '__all' ? undefined : key)}
    />
  );
});

CategoryTabs.displayName = 'PresetCategoryTabs';

export default CategoryTabs;
