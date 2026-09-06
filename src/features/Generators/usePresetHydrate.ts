'use client';

import { useCallback } from 'react';

import { lambdaQuery } from '@/libs/trpc/client';
import type { Preset } from '@/types/preset';

/**
 * `presets.list` intentionally omits `prompt_template`, so a gallery card only
 * carries a `PresetListItem`. `selectPreset` needs the full row (prompt +
 * params lock), so the click path has to hydrate first.
 *
 * Returns an imperative fetch that goes through the tRPC react-query cache:
 * repeated clicks on the same preset, and the `?preset=` deep link (which
 * issues the identical `getBySlug` query), share one network round trip.
 */
export const usePresetHydrate = (): ((slug: string) => Promise<Preset | null>) => {
  const utils = lambdaQuery.useUtils();

  return useCallback(
    (slug: string) => utils.presets.getBySlug.fetch({ slug }, { staleTime: 5 * 60 * 1000 }),
    [utils],
  );
};
