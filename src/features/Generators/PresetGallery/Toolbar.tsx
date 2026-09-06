'use client';

import { ActionIcon } from '@lobehub/ui';
import { Input } from 'antd';
import { createStyles } from 'antd-style';
import { Search, X } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsMobile } from '@/hooks/useIsMobile';
import type { PresetModality, PresetSort } from '@/types/preset';

import CategoryChips from './CategoryChips';
import ModelFilter from './ModelFilter';
import SortSwitcher from './SortSwitcher';

interface Props {
  category: string | undefined;
  modality: PresetModality;
  modelId: string | undefined;
  onCategoryChange: (slug: string | undefined) => void;
  onModelChange: (modelId: string | undefined) => void;
  onSortChange: (sort: PresetSort) => void;
  onTextChange: (text: string) => void;
  sort: PresetSort;
  /** Live (un-debounced) search text — the input is controlled by the parent. */
  text: string;
}

const useStyles = createStyles(({ css, token }) => ({
  /**
   * Sticks to the top of the gallery's own scroll container. Opaque, so
   * tiles scrolling underneath never bleed through the chips.
   */
  root: css`
    position: sticky;
    z-index: 5;
    inset-block-start: 0;

    display: flex;
    flex-direction: column;
    gap: 8px;

    padding-block: 8px;
    padding-inline: 16px;
    border-block-end: 1px solid ${token.colorBorderSecondary};

    background: ${token.colorBgLayout};
  `,
  row: css`
    display: flex;
    gap: 8px;
    align-items: center;
    min-inline-size: 0;
  `,
  grow: css`
    flex: 1 1 auto;
    min-inline-size: 0;

    /* Search is used once a session — cap it so it doesn't span the whole row
       on wide screens (reference keeps it compact). */
    max-inline-size: 480px;
  `,
}));

/**
 * Browse controls for the gallery, in two rows.
 *
 * Desktop: `[search][model]` then `[category chips …][sort]`.
 * Mobile:  `[🔍][⇅ sort][category chips …]`, with 🔍 unfolding a
 * `[search][model]` row above — the search box is used once a session and
 * does not earn 48px of permanent chrome on a 375px screen, while the
 * chips are the filter people actually browse by.
 *
 * Purely presentational: state (debounce, reset, sort) stays in `index.tsx`.
 */
const Toolbar = memo<Props>(
  ({
    category,
    modality,
    modelId,
    onCategoryChange,
    onModelChange,
    onSortChange,
    onTextChange,
    sort,
    text,
  }) => {
    const { styles, cx } = useStyles();
    const { t } = useTranslation('common');
    const isMobile = useIsMobile();
    const [searchOpen, setSearchOpen] = useState(false);

    // Once there is a query or a model filter, the row that shows them
    // stays open — hiding an active filter is how "why is the list empty"
    // happens.
    const showSearchRow = !isMobile || searchOpen || !!text || !!modelId;

    const searchRow = (
      <div className={styles.row}>
        <Input
          allowClear
          autoFocus={isMobile && searchOpen}
          className={styles.grow}
          placeholder={t('preset.searchPlaceholder')}
          prefix={<Search size={14} />}
          size="large"
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
        />
        <ModelFilter modality={modality} selected={modelId} onSelect={onModelChange} />
        {isMobile && (
          <ActionIcon
            aria-label={t('close')}
            icon={X}
            size="large"
            onClick={() => {
              setSearchOpen(false);
              onTextChange('');
              onModelChange(undefined);
            }}
          />
        )}
      </div>
    );

    if (isMobile) {
      return (
        <div className={styles.root}>
          {showSearchRow && searchRow}
          <div className={styles.row}>
            {!showSearchRow && (
              <ActionIcon
                aria-label={t('preset.searchPlaceholder')}
                icon={Search}
                size="large"
                onClick={() => setSearchOpen(true)}
              />
            )}
            <SortSwitcher compact value={sort} onChange={onSortChange} />
            <div className={cx(styles.grow)}>
              <CategoryChips modality={modality} selected={category} onSelect={onCategoryChange} />
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className={styles.root}>
        {searchRow}
        <div className={styles.row}>
          <div className={styles.grow}>
            <CategoryChips modality={modality} selected={category} onSelect={onCategoryChange} />
          </div>
          <SortSwitcher value={sort} onChange={onSortChange} />
        </div>
      </div>
    );
  },
);

Toolbar.displayName = 'PresetGalleryToolbar';

export default Toolbar;
