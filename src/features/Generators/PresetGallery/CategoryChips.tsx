'use client';

import { createStyles } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaQuery } from '@/libs/trpc/client';
import type { PresetModality } from '@/types/preset';

import { ALL_CATEGORIES_KEY, categoryLabel, compareCategories } from '../PRESET_CATEGORIES';

interface Props {
  modality: PresetModality;
  onSelect: (slug: string | undefined) => void;
  /** undefined or '__all' = no category filter */
  selected: string | undefined;
}

const useStyles = createStyles(({ css, token }) => ({
  scroller: css`
    scrollbar-width: none;

    overflow-x: auto;
    display: flex;
    flex: 0 0 auto;
    gap: 8px;

    padding-block-end: 2px;

    -webkit-overflow-scrolling: touch;

    &::-webkit-scrollbar {
      display: none;
    }
  `,
  chip: css`
    cursor: pointer;

    display: inline-flex;
    flex: 0 0 auto;
    gap: 6px;
    align-items: center;

    /* One-handed target on a phone: 40px is the floor, not the ideal. */
    min-block-size: 40px;
    padding-block: 0;
    padding-inline: 14px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 20px;

    font-size: 13px;
    color: ${token.colorText};
    white-space: nowrap;

    background: ${token.colorBgContainer};

    transition:
      background 0.15s ease,
      border-color 0.15s ease;

    &:hover {
      border-color: ${token.colorPrimaryBorderHover};
    }
  `,
  chipActive: css`
    border-color: transparent;
    color: ${token.colorTextLightSolid};
    background: ${token.colorPrimary};

    &:hover {
      border-color: transparent;
    }
  `,
  count: css`
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    opacity: 0.65;
  `,
}));

/**
 * Category filter for the gallery, built from `presets.facets` — i.e. from
 * the categories that actually exist in the DB for this modality, so a
 * category the ingest cron invents is reachable the moment its first row
 * lands.
 *
 * These were antd `Tabs`, which is fine at six tabs and unusable at the 20+
 * the ingest brings: the strip either overflows into a hidden "more" menu or
 * squeezes labels to nothing. Chips scroll horizontally instead, carry their
 * row count so the user can see where the catalogue actually is, and are
 * sized for a thumb rather than a cursor.
 */
const CategoryChips = memo<Props>(({ modality, onSelect, selected }) => {
  const { styles, cx } = useStyles();
  const { t } = useTranslation('common');
  const { data } = lambdaQuery.presets.facets.useQuery({ modality }, { staleTime: 5 * 60 * 1000 });

  const chips = useMemo(() => {
    // Fixed editorial order, not by count: counts move with every nightly
    // ingest and a strip that reshuffles is one the user cannot learn.
    const categories = [...(data?.categories ?? [])].sort(compareCategories);
    const total = categories.reduce((sum, f) => sum + f.count, 0);
    return [
      { count: total, key: ALL_CATEGORIES_KEY, label: t('preset.allCategories') },
      ...categories.map((f) => ({
        count: f.count,
        key: f.category,
        label: categoryLabel(f.category),
      })),
    ];
  }, [data, t]);

  // One lone «Все» chip is noise, not a filter.
  if (chips.length < 2) return null;

  const active = selected ?? ALL_CATEGORIES_KEY;

  return (
    <div aria-label={t('preset.categories')} className={styles.scroller} role="group">
      {chips.map((chip) => (
        <button
          aria-pressed={chip.key === active}
          className={cx(styles.chip, chip.key === active && styles.chipActive)}
          key={chip.key}
          type="button"
          onClick={() => onSelect(chip.key === ALL_CATEGORIES_KEY ? undefined : chip.key)}
        >
          {chip.label}
          <span className={styles.count}>{chip.count}</span>
        </button>
      ))}
    </div>
  );
});

CategoryChips.displayName = 'PresetCategoryChips';

export default CategoryChips;
