'use client';

import { useMemo } from 'react';

import { lambdaQuery } from '@/libs/trpc/client';
import type { PresetListItem, PresetModality, PresetSort } from '@/types/preset';

const STALE_MS = 5 * 60 * 1000;

/**
 * Presets for a home-page row: editorially pinned ones (`featured`) first,
 * the regular ranking filling the rest. The second query only runs when the
 * pinned set is shorter than the row, so with nothing pinned the page makes
 * the same single request it always did.
 */
export const useHomePresets = ({
  limit,
  modality,
  sort,
}: {
  limit: number;
  modality: PresetModality;
  sort?: PresetSort;
}): { isLoading: boolean; items: PresetListItem[] } => {
  const pinned = lambdaQuery.presets.list.useQuery(
    { featured: true, limit, modality, sort },
    { staleTime: STALE_MS },
  );
  const pinnedItems = pinned.data?.items;
  const needsFill = !!pinnedItems && pinnedItems.length < limit;

  const rest = lambdaQuery.presets.list.useQuery(
    { limit, modality, sort },
    { enabled: needsFill, staleTime: STALE_MS },
  );

  const items = useMemo(() => {
    if (!pinnedItems) return [];
    if (pinnedItems.length >= limit) return pinnedItems.slice(0, limit);
    const seen = new Set(pinnedItems.map((p) => p.slug));
    const fill = (rest.data?.items ?? []).filter((p) => !seen.has(p.slug));
    return [...pinnedItems, ...fill].slice(0, limit);
  }, [limit, pinnedItems, rest.data]);

  return { isLoading: pinned.isLoading || (needsFill && rest.isLoading), items };
};
