'use client';

// Use the react-router-dom-backed wrapper — `next/navigation`'s pathname
// is bound to the Next.js router and does NOT update on SPA navigation
// inside the (main) tree, so the tab bar would never hide on chat threads.
import { usePathname } from '@/libs/router/navigation';

/**
 * Whether the bottom MobileTabBar should render on the current page.
 *
 * Hidden on:
 * - chat threads (`/chat/[topicId]`) — needs full vertical space for messages
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

  // Chat thread = `/chat/<id>` with anything after the slash
  if (/^\/chat\/[^/]+/.test(pathname)) return false;

  return true;
};
