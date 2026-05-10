'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';

import { useIsMobile } from '@/hooks/useIsMobile';
import { SettingsTabs } from '@/store/global/initialState';

import { type LayoutProps } from './_layout/type';
import SettingsContent from './features/SettingsContent';
import MobileSettingsList from './MobileSettingsList';

/**
 * Mobile scroll wrapper.
 *
 * `DesktopLayoutContainer` (parent of every (main) route) sets
 * `overflow: hidden` on both its outer and inner shells so chat-style
 * pages can manage their own scroll context. Settings pages have no
 * internal scroll — without this wrapper their content is just clipped
 * on phones where it overflows the viewport. The `paddingBlockEnd`
 * leaves room for the fixed `MobileTabBar` (~64px) plus iOS safe-area.
 */
const MobileScrollWrapper = ({ children }: { children: ReactNode }) => (
  <Flexbox
    height={'100%'}
    width={'100%'}
    style={{
      WebkitOverflowScrolling: 'touch',
      overflowY: 'auto',
      paddingBlockEnd: 'calc(env(safe-area-inset-bottom, 0px) + 80px)',
    }}
  >
    {children}
  </Flexbox>
);

const Layout = memo<LayoutProps>(() => {
  const params = useParams<{ tab?: string }>();
  const isMobile = useIsMobile();

  // On mobile, the bare `/settings` route shows a list-of-links instead
  // of the desktop sidebar + content split. When a specific sub-route is
  // already in the URL (`/settings/profile`, `/settings/billing`, etc.)
  // fall through to the same SettingsContent the desktop uses, with the
  // `mobile` prop set so its internal layout adapts.
  if (isMobile && !params.tab) {
    return (
      <MobileScrollWrapper>
        <MobileSettingsList />
      </MobileScrollWrapper>
    );
  }

  const activeTab = (params.tab as SettingsTabs) || SettingsTabs.Profile;

  if (isMobile) {
    return (
      <MobileScrollWrapper>
        <SettingsContent mobile activeTab={activeTab} />
      </MobileScrollWrapper>
    );
  }

  return <SettingsContent activeTab={activeTab} mobile={false} />;
});

Layout.displayName = 'SettingsLayout';

export default Layout;
