import { useCallback, useEffect } from 'react';

import { useResourceManagerStore } from '@/app/[variants]/(main)/resource/features/store';
import { type ViewMode } from '@/app/[variants]/(main)/resource/features/store/initialState';
import { parseAsStringEnum, useQueryState } from '@/hooks/useQueryParam';

/**
 * Hook to manage view mode with URL query sync
 * Returns [viewMode, setViewMode] tuple like useState
 * Handles bidirectional sync between store and URL query parameter
 */
export const useViewMode = (): [ViewMode, (mode: ViewMode) => void] => {
  // View mode from store
  const [viewModeFromStore, setViewModeInStore] = useResourceManagerStore((s) => [
    s.viewMode,
    s.setViewMode,
  ]);

  // Sync view mode with URL query parameter
  const [viewModeFromUrl, setViewModeInUrl] = useQueryState(
    'view',
    // Default MUST match the store default (initialState.viewMode = 'masonry'):
    // this hook writes the URL value back into the store on mount, so a
    // 'list' default here silently overrode the masonry default and every
    // "Мои генерации" tab opened as a text list (2026-09-21). Grid is what
    // image/video generations need; users can still flip via the toolbar.
    parseAsStringEnum(['list', 'masonry'] as const).withDefault('masonry'),
  );

  useEffect(() => {
    setViewModeInStore(viewModeFromUrl);
  }, [viewModeFromUrl]);

  const setViewMode = useCallback(
    (mode: ViewMode) => {
      setViewModeInStore(mode);
      setViewModeInUrl(mode);
    },
    [setViewModeInStore, setViewModeInUrl],
  );

  return [viewModeFromStore, setViewMode];
};
