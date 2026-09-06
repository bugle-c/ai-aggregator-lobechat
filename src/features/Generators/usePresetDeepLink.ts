'use client';

import { useEffect, useRef } from 'react';

import { lambdaQuery } from '@/libs/trpc/client';
import type { Preset, PresetModality } from '@/types/preset';

interface Options {
  /** Slug of the preset already selected in the store, if any. */
  currentSlug: string | null;
  /** Guards against applying a video preset on the image page and vice versa. */
  modality: PresetModality;
  selectPreset: (preset: Preset) => void;
  /** `?preset=<slug>` from the URL. */
  slug: string | undefined;
}

/**
 * Hydrates the store's selected preset from a `?preset=<slug>` deep link.
 *
 * Home-page cards navigate to `/image?preset=<slug>` / `/video?preset=<slug>`;
 * without this the flow page rendered an unfiltered gallery with nothing
 * selected, breaking the browse → create path.
 *
 * The `appliedRef` guard makes this a one-shot per slug: if the user then
 * clears the preset (which does not rewrite the URL), we do not re-apply it
 * on the next render.
 */
export const usePresetDeepLink = ({ currentSlug, modality, selectPreset, slug }: Options): void => {
  const appliedRef = useRef<string | null>(null);

  const shouldFetch = !!slug && !currentSlug && appliedRef.current !== slug;

  const { data } = lambdaQuery.presets.getBySlug.useQuery(
    { slug: slug ?? '' },
    { enabled: shouldFetch, staleTime: 5 * 60 * 1000 },
  );

  useEffect(() => {
    if (!slug || currentSlug || !data) return;
    if (appliedRef.current === slug) return;
    if (data.slug !== slug || data.modality !== modality) return;

    appliedRef.current = slug;
    selectPreset(data);
  }, [data, slug, currentSlug, modality, selectPreset]);
};
