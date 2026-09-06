'use client';

import { Button, Dropdown, Segmented } from 'antd';
import { ArrowUpDown } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { PresetSort } from '@/types/preset';

interface Props {
  block?: boolean;
  /**
   * Render as a single icon-only dropdown chip instead of a segmented
   * control. On a phone the three-way `Segmented` cost a full 40px row, and
   * a labelled chip («Подборка» + chevron) still ate ~110px of the row it
   * shares with the category chips, leaving them 146px on a 390px screen.
   * The current sort is carried by the accessible name instead.
   */
  compact?: boolean;
  onChange: (sort: PresetSort) => void;
  value: PresetSort;
}

/**
 * Visible entry points for the `sort` input `presets.list` has always
 * accepted but nothing in the UI could reach: «Подборка» (curated, the
 * default and the only ordering a hand-curated catalogue had), «Популярное»
 * (source-side likes, meaningful now that rows are ingested) and «Новое».
 *
 * Desktop: a `Segmented` — with three options the whole choice should be
 * visible and one click away. Mobile (`compact`): an icon-only dropdown chip
 * whose `aria-label` and `title` name the current sort.
 */
const SortSwitcher = memo<Props>(({ block, compact, onChange, value }) => {
  const { t } = useTranslation('common');

  const options = useMemo(
    () => [
      { label: t('preset.sort.curated'), value: 'curated' as const },
      { label: t('preset.sort.popular'), value: 'popular' as const },
      { label: t('preset.sort.new'), value: 'new' as const },
    ],
    [t],
  );

  if (compact) {
    const current = options.find((o) => o.value === value) ?? options[0];
    const label = `${t('preset.sortLabel')}: ${current.label}`;
    return (
      <Dropdown
        trigger={['click']}
        menu={{
          items: options.map((o) => ({ key: o.value, label: o.label })),
          onClick: ({ key }) => onChange(key as PresetSort),
          selectedKeys: [value],
        }}
      >
        <Button
          aria-label={label}
          icon={<ArrowUpDown size={16} />}
          shape="circle"
          // 40px — the same one-handed tap floor as the category chips,
          // pinned so antd's icon-only padding cannot widen it: every pixel
          // here comes straight out of the chips scroller next to it.
          size="large"
          title={label}
          style={{
            blockSize: 40,
            flex: '0 0 auto',
            inlineSize: 40,
            minInlineSize: 40,
            paddingInline: 0,
          }}
        />
      </Dropdown>
    );
  }

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
