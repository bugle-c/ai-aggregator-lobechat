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
 * Format a canonical model_id like
 * `bytedance/seedance-2.0-fast/text-to-video` into a user-readable
 * label `Seedance 2.0 Fast`. Falls back to a title-cased bare slug
 * (`flux-pro` → `Flux Pro`).
 *
 * We don't fetch the real `displayName` from `model-bank` here to keep
 * the tab list a pure derivation of the preset list. If the prettified
 * label diverges from the registry's canonical name for a given model,
 * adjust by upgrading to a full lookup later.
 */
const prettifyModelId = (modelId: string): string => {
  const parts = modelId.split('/');
  const core = parts.length >= 2 ? parts[1] : parts[0];
  return core
    .split('-')
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
};

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
      tabs.push({ key: p.modelId, label: prettifyModelId(p.modelId) });
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
