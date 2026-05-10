'use client';

import { Tabs } from 'antd';
import { memo, useMemo } from 'react';

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
  const { data: presets } = lambdaQuery.presets.list.useQuery(
    { modality },
    { staleTime: 5 * 60 * 1000 },
  );

  const items = useMemo(() => {
    if (!presets) return [{ key: '__all', label: 'Все' }];
    const seen = new Set<string>();
    const tabs: { key: string; label: string }[] = [{ key: '__all', label: 'Все' }];
    for (const p of presets) {
      if (seen.has(p.modelId)) continue;
      seen.add(p.modelId);
      tabs.push({ key: p.modelId, label: p.modelId });
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
