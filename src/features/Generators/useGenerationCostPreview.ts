/**
 * Cost-preview hook for the image/video generate button.
 *
 * Wraps the lambdaQuery.quote.{imageCost,videoCost} procedures with a
 * debounce on the request shape so dragging a slider (duration, image
 * count) doesn't fire one tRPC roundtrip per pixel. Debounce window is
 * 300ms — short enough to feel live, long enough to coalesce a typical
 * slider drag into a single request.
 *
 * The preview is purely informational. It does NOT gate the click —
 * the server-side preflight (`checkUsageLimit` / `chargeBefore`) still
 * runs and returns the canonical insufficient-balance error if the
 * picture changed between preview and submit. UI uses `sufficient` only
 * for visual hint (red Sparkles button).
 */
import { useEffect, useState } from 'react';

import { lambdaQuery } from '@/libs/trpc/client';

interface ImageInput {
  images?: number;
  kind: 'image';
  model: string | undefined;
}

interface VideoInput {
  durationSeconds: number;
  kind: 'video';
  model: string | undefined;
}

type Input = ImageInput | VideoInput;

export interface CostPreview {
  balance: number | null;
  credits: number | null;
  isLoading: boolean;
  sufficient: boolean;
}

const DEBOUNCE_MS = 300;

/**
 * Stringify the input so React Query treats only material changes as a
 * new query, and debounce the stringified key so rapid edits coalesce.
 * The hook returns the latest *fetched* value, so during the debounce
 * window the previous preview stays on screen instead of flickering to
 * "loading…" (better UX while the user is still adjusting params).
 */
function useDebouncedKey(key: string): string {
  const [debounced, setDebounced] = useState(key);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(key), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [key]);
  return debounced;
}

export function useGenerationCostPreview(input: Input): CostPreview {
  const isImage = input.kind === 'image';
  const model = input.model;

  // Build a stable serializable key for debouncing. Empty model →
  // preview is disabled and we never fire a query.
  const liveKey = JSON.stringify(
    isImage
      ? { kind: 'image', model, images: (input as ImageInput).images ?? 1 }
      : { kind: 'video', model, durationSeconds: (input as VideoInput).durationSeconds },
  );
  const debouncedKey = useDebouncedKey(liveKey);
  const debounced = JSON.parse(debouncedKey) as
    | { images: number; kind: 'image'; model: string | undefined }
    | { durationSeconds: number; kind: 'video'; model: string | undefined };

  const imageQuery = lambdaQuery.quote.imageCost.useQuery(
    {
      model: debounced.model ?? '',
      params: { images: debounced.kind === 'image' ? debounced.images : 1 },
    },
    {
      enabled: !!debounced.model && debounced.kind === 'image',
      // Keep the previous preview visible while a new one is loading.
      placeholderData: (prev) => prev,
      staleTime: 30_000,
    },
  );

  const videoQuery = lambdaQuery.quote.videoCost.useQuery(
    {
      durationSeconds: debounced.kind === 'video' ? debounced.durationSeconds : 1,
      model: debounced.model ?? '',
    },
    {
      enabled:
        !!debounced.model &&
        debounced.kind === 'video' &&
        (debounced as { durationSeconds: number }).durationSeconds > 0,
      placeholderData: (prev) => prev,
      staleTime: 30_000,
    },
  );

  const active = isImage ? imageQuery : videoQuery;
  const data = active.data;

  return {
    balance: data?.balance ?? null,
    credits: data?.credits ?? null,
    isLoading: active.isLoading,
    // Default to `true` while we have no answer yet — we don't want to
    // flash a red button on first paint before the query resolves.
    sufficient: data?.sufficient ?? true,
  };
}
