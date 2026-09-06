'use client';

import { Select } from 'antd';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

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
 * Secondary filter: which model a preset is tuned for.
 *
 * This used to be a second antd `Tabs` strip stacked above the category one,
 * so two scrolling strips competed for the same width and neither read as
 * primary. Category is the filter people actually browse by, so the model
 * collapses into one compact dropdown. Options come from `presets.facets`,
 * the same query the chips use (react-query dedupes it).
 */
const ModelFilter = memo<Props>(({ modality, onSelect, selected }) => {
  const { t } = useTranslation('common');
  const { data } = lambdaQuery.presets.facets.useQuery({ modality }, { staleTime: 5 * 60 * 1000 });

  const options = useMemo(
    () => [
      { label: t('preset.allModels'), value: ALL_MODELS_KEY },
      ...(data?.models ?? []).map((f) => ({
        label: `${prettifyModelId(f.modelId)} · ${f.count}`,
        value: f.modelId,
      })),
    ],
    [data, t],
  );

  // Nothing to choose between — don't spend a control on it.
  if (options.length < 2) return null;

  return (
    <Select
      aria-label={t('preset.model')}
      options={options}
      // `large` is 40px tall, the same one-handed tap floor as the chips.
      size="large"
      style={{ flex: '0 0 auto', minWidth: 150 }}
      value={selected ?? ALL_MODELS_KEY}
      onChange={(key) => onSelect(key === ALL_MODELS_KEY ? undefined : key)}
    />
  );
});

ModelFilter.displayName = 'PresetModelFilter';

export default ModelFilter;
