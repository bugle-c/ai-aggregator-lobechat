'use client';

// Use the react-router-dom-backed wrapper — `next/navigation`'s pathname
// is bound to the Next.js router and does NOT update on SPA navigation
// inside the (main) tree, so the tab bar would never hide on chat threads.
import { usePathname } from '@/libs/router/navigation';

/**
 * Whether the bottom MobileTabBar should render on the current page.
 *
 * Hidden on:
 * - chat threads (`/agent/<id>`, `/group/<id>`) — needs full vertical
 *   space for messages; the chat header has its own back-arrow.
 *
 * Shown on:
 * - home (`/`)
 * - feature pages (`/image`, `/video`)
 * - all settings pages (mobile users still navigate via tabs from there)
 *
 * Pure function of pathname; tests mock `usePathname`.
 */
export const useShowTabBar = (): boolean => {
  const pathname = usePathname();
  if (!pathname) return true;

  // Chat thread routes on this fork live under `/agent/` and
  // `/group/`. The legacy `/chat/<id>` pattern is also matched for
  // forward-compat in case upstream re-introduces it.
  if (/^\/(?:agent|group|chat)\/[^/]+/.test(pathname)) return false;

  return true;
};
