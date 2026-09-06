'use client';

import { Segmented } from 'antd';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { PresetSort } from '@/types/preset';

interface Props {
  block?: boolean;
  onChange: (sort: PresetSort) => void;
  value: PresetSort;
}

/**
 * Visible entry points for the `sort` input `presets.list` has always
 * accepted but nothing in the UI could reach: «Подборка» (curated, the
 * default and the only ordering a hand-curated catalogue had), «Популярное»
 * (source-side likes, meaningful now that rows are ingested) and «Новое».
 *
 * A `Segmented`, not a dropdown: with three options the whole choice should
 * be visible and one tap away, and it has no hover-only affordance.
 */
const SortSwitcher = memo<Props>(({ block, onChange, value }) => {
  const { t } = useTranslation('common');

  const options = useMemo(
    () => [
      { label: t('preset.sort.curated'), value: 'curated' as const },
      { label: t('preset.sort.popular'), value: 'popular' as const },
      { label: t('preset.sort.new'), value: 'new' as const },
    ],
    [t],
  );

  return (
    <Segmented
      aria-label={t('preset.sortLabel')}
      block={block}
      options={options}
      // 40px tall, matching the category chips' one-handed tap floor.
      size="large"
      value={value}
      onChange={(v) => onChange(v as PresetSort)}
    />
  );
});

SortSwitcher.displayName = 'PresetSortSwitcher';

export default SortSwitcher;
