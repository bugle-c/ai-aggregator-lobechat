'use client';

import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';
import { Outlet } from 'react-router-dom';

import SideBar from '@/app/[variants]/(main)/settings/_layout/SideBar';
import { useIsMobile } from '@/hooks/useIsMobile';

import SettingsContextProvider from './ContextProvider';
import { styles } from './style';

/**
 * Mobile-only scroll context.
 *
 * `DesktopLayoutContainer` (parent of every (main) route) sets
 * `overflow: hidden` on both its outer and inner shells so chat-style
 * pages can manage their own scroll. Settings sub-pages have no
 * internal scroll — without this wrapper their content gets clipped
 * on phones. Bottom padding leaves room for the fixed `MobileTabBar`
 * (~64px) plus iOS safe-area inset. Lives at the layout level so every
 * settings sub-route (`:tab`, `provider/:id`, the index list, etc.)
 * inherits scroll without duplicating wrapper logic.
 */
const Layout: FC = () => {
  const isMobile = useIsMobile();

  return (
    <SettingsContextProvider
      value={{
        showOpenAIApiKey: true,
        showOpenAIProxyUrl: true,
      }}
    >
      {/* Desktop-only sidebar — on mobile the SettingsTabs sidebar is
          replaced by the `MobileSettingsList` shown at `/settings`. */}
      {!isMobile && <SideBar />}
      <Flexbox
        className={styles.mainContainer}
        flex={1}
        height={'100%'}
        style={
          isMobile
            ? {
                WebkitOverflowScrolling: 'touch',
                overflowY: 'auto',
                paddingBlockEnd: 'calc(env(safe-area-inset-bottom, 0px) + 80px)',
              }
            : undefined
        }
      >
        <Outlet />
      </Flexbox>
    </SettingsContextProvider>
  );
};

export default Layout;
