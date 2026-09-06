'use client';

import { Tabs } from 'antd';
import { memo, useMemo } from 'react';

import { prettifyModelId } from '@/features/Generators/prettifyModelId';
import { lambdaQuery } from '@/libs/trpc/client';
import type { PresetModality } from '@/types/preset';

const ALL_MODELS_KEY = '__all';

interface Props {
  modality: PresetModality;
  onSelect: (modelId: string | undefined) => void;
  /** undefined = "All models" */
  selected: string | undefined;
}

/**
 * Top tabs for the preset gallery — one tab per model that has at least one
 * active preset for the current modality, so adding a new model+preset
 * auto-adds a tab.
 *
 * Reads `presets.facets`, the same query `CategoryTabs` uses (react-query
 * dedupes it). This used to fetch the entire preset list a second time purely
 * to collect distinct model ids.
 */
const ModelTabs = memo<Props>(({ modality, onSelect, selected }) => {
  const { data } = lambdaQuery.presets.facets.useQuery({ modality }, { staleTime: 5 * 60 * 1000 });

  const items = useMemo(() => {
    const tabs = [{ key: ALL_MODELS_KEY, label: 'Все' }];
    for (const f of data?.models ?? [])
      tabs.push({ key: f.modelId, label: prettifyModelId(f.modelId) });
    return tabs;
  }, [data]);

  return (
    <Tabs
      activeKey={selected ?? ALL_MODELS_KEY}
      items={items}
      size="small"
      onChange={(key) => onSelect(key === ALL_MODELS_KEY ? undefined : key)}
    />
  );
});

ModelTabs.displayName = 'PresetModelTabs';

export default ModelTabs;
