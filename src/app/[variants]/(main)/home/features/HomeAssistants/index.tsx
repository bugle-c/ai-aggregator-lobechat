'use client';

import { Flexbox } from '@lobehub/ui';
import { Skeleton } from 'antd';
import { ArrowRight } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { useIsMobile } from '@/hooks/useIsMobile';
import { useDiscoverStore } from '@/store/discover';
import { useHomeStore } from '@/store/home';
import { AssistantSorts } from '@/types/discover';

import HomeAssistantItem from './Item';

const PAGE_SIZE = 9;
/** Route of the full community agent marketplace (verified to exist). */
const MARKETPLACE_PATH = '/community/agent';
/** Stable keys for the skeleton placeholder cells. */
const SKELETON_KEYS = Array.from({ length: PAGE_SIZE }, (_, i) => `assistant-skeleton-${i}`);

/**
 * "Популярные ассистенты" — a compact card grid of ready-made assistants from
 * the LobeChat discover marketplace (remote lobehub fetch).
 *
 * Layout: ~3 columns on desktop, 2 on tablet, a horizontal-scroll strip on
 * mobile (each card fixed-width so the row never collapses into a stack).
 *
 * Robustness: the data is a remote fetch that RU users may have throttled
 * (DPI). It shows a skeleton while loading and self-hides (renders null) when
 * the list is empty or the fetch errors — it must NEVER block or break the
 * home. Clicking a card opens that assistant in the community marketplace.
 */
const HomeAssistants = memo(() => {
  const { t } = useTranslation('home');
  const isMobile = useIsMobile();
  const navigate = useHomeStore((s) => s.navigate);

  const useAssistantList = useDiscoverStore((s) => s.useAssistantList);
  const { data, isLoading, error } = useAssistantList({
    page: 1,
    pageSize: PAGE_SIZE,
    sort: AssistantSorts.Recommended,
  });

  const openAssistant = useCallback(
    (identifier: string) => {
      navigate?.(urlJoin(MARKETPLACE_PATH, identifier));
    },
    [navigate],
  );

  // Self-hide on a failed remote fetch or a genuinely empty list — never block
  // the home. While loading we keep the section and show a skeleton grid.
  if (!isLoading && (error || !data || data.items.length === 0)) return null;

  const items = (data?.items ?? []).slice(0, PAGE_SIZE);

  // Each cell: responsive flex column. Desktop ~3 / tablet ~2 columns via
  // flex-basis breakpoints; mobile becomes a fixed-width horizontal strip.
  const cellStyle = isMobile
    ? ({ flex: '0 0 220px', minWidth: 220 } as const)
    : ({ flex: '1 1 30%', maxWidth: 'calc(33.333% - 12px)', minWidth: 240 } as const);

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal align="center" justify="space-between" paddingInline={16}>
        <span style={{ fontSize: 18, fontWeight: 600 }}>{t('assistants.title')}</span>
        <a
          style={{
            alignItems: 'center',
            color: 'var(--ant-color-text-secondary)',
            display: 'inline-flex',
            fontSize: 14,
            gap: 4,
          }}
          onClick={(e) => {
            e.preventDefault();
            navigate?.(MARKETPLACE_PATH);
          }}
        >
          {t('assistants.all')}
          <ArrowRight size={14} />
        </a>
      </Flexbox>

      <div
        style={{
          display: 'flex',
          flexWrap: isMobile ? 'nowrap' : 'wrap',
          gap: 12,
          overflowX: isMobile ? 'auto' : 'visible',
          paddingBlockEnd: isMobile ? 4 : 0,
          paddingInline: 16,
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {isLoading
          ? SKELETON_KEYS.map((key) => (
              <div key={key} style={cellStyle}>
                <Skeleton.Node active style={{ borderRadius: 12, height: 116, width: '100%' }} />
              </div>
            ))
          : items.map((item) => (
              <div key={item.identifier} style={cellStyle}>
                <HomeAssistantItem {...item} onClick={() => openAssistant(item.identifier)} />
              </div>
            ))}
      </div>
    </Flexbox>
  );
});

HomeAssistants.displayName = 'HomeAssistants';

export default HomeAssistants;
