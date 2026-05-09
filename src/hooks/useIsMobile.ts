import { useServerConfigStore } from '@/store/serverConfig';

/**
 * Whether the current request is from a mobile-class device.
 *
 * Reads the SSR-time UA-detected `isMobile` from `serverConfig` store
 * (populated by `RouteVariants.deserializeVariants` in the root layout
 * → propagated through GlobalProvider → StoreInitialization.tsx).
 *
 * Why not `antd-style.useResponsive()`:
 *   - That hook returns `mobile=undefined` during SSR and a real
 *     boolean after first client tick. Feeding the fluctuating value
 *     into conditional renders crashed components with React error
 *     #310 ("Rendered more hooks than during the previous render"),
 *     because `useBreakpoint` itself uses different hooks on the two
 *     ticks.
 *   - The store-backed value is stable from the very first render,
 *     identical on server and client, and is the same source the
 *     legacy (mobile) route already uses for its own detection.
 *
 * Caveat: window-resize on a desktop browser doesn't flip this flag —
 * it's UA-based, not breakpoint-based. For mobile browsers the UA is
 * stable anyway, so this is fine for our use cases (rendering mobile
 * tab-bar, hiding sidebars, etc.).
 */
export const useIsMobile = (): boolean => {
  return !!useServerConfigStore((s) => s.isMobile);
};
