'use client';

import { Tabs } from 'antd';
import { memo, useMemo } from 'react';

import { prettifyModelId } from '@/features/Generators/prettifyModelId';
import { lambdaQuery } from '@/libs/trpc/client';
import type { PresetModality } from '@/types/preset';

interface Props {
  modality: PresetModality;
  onSelect: (modelId: string | undefined) => void;
  /** undefined = "All models" */
  selected: string | undefined;
}

/**
 * Top tabs for the preset gallery — one tab per model that has at
 * least one active preset for the current modality. Derived from the
 * preset list itself (no separate models endpoint), so adding a new
 * model+preset auto-adds a tab.
 */
const ModelTabs = memo<Props>(({ modality, onSelect, selected }) => {
  // `limit: 100` (the endpoint's max) rather than the default page size —
  // this list only exists to derive the tab strip. Replaced by the facets
  // endpoint in the next commit.
  const { data } = lambdaQuery.presets.list.useQuery(
    { limit: 100, modality },
    { staleTime: 5 * 60 * 1000 },
  );
  const presets = data?.items;

  const items = useMemo(() => {
    if (!presets) return [{ key: '__all', label: 'Все' }];
    const seen = new Set<string>();
    const tabs: { key: string; label: string }[] = [{ key: '__all', label: 'Все' }];
    for (const p of presets) {
      const id = p.recommendedModelId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      tabs.push({ key: id, label: prettifyModelId(id) });
    }
    return tabs;
  }, [presets]);

  return (
    <Tabs
      activeKey={selected ?? '__all'}
      items={items}
      size="small"
      onChange={(key) => onSelect(key === '__all' ? undefined : key)}
    />
  );
});

ModelTabs.displayName = 'PresetModelTabs';

export default ModelTabs;
