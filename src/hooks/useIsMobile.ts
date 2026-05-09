import { useResponsive } from 'antd-style';
import { useEffect, useMemo, useState } from 'react';

/**
 * Stable boolean indicating whether we're rendering on a mobile-width
 * viewport.
 *
 * antd-style's `useResponsive` returns `mobile=undefined` during SSR and
 * `mobile=true|false` after first client effect — feeding that
 * fluctuating value directly into conditional renders triggered React
 * error #310 (hook count mismatch between SSR and the post-hydration
 * client render) for components down-tree that mounted/unmounted with
 * the change.
 *
 * We solve this by:
 *   1. Returning `false` until the component has fully mounted on the
 *      client (so SSR and first-paint agree),
 *   2. Then committing the actual breakpoint value on the second tick.
 *
 * The tiny visual flash of "desktop layout, then mobile layout" is
 * preferable to a runtime crash. Mobile users see one re-render,
 * desktop users see one re-render with no visible difference.
 */
export const useIsMobile = (): boolean => {
  const { mobile } = useResponsive();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  return useMemo(() => hydrated && !!mobile, [hydrated, mobile]);
};
