'use client';

import { memo } from 'react';
import { useParams } from 'react-router-dom';

import { useIsMobile } from '@/hooks/useIsMobile';
import { SettingsTabs } from '@/store/global/initialState';

import MobileSettingsList from './MobileSettingsList';
import { type LayoutProps } from './_layout/type';
import SettingsContent from './features/SettingsContent';

const Layout = memo<LayoutProps>(() => {
  const params = useParams<{ tab?: string }>();
  const isMobile = useIsMobile();

  // On mobile, the bare `/settings` route shows a list-of-links instead
  // of the desktop sidebar + content split. When a specific sub-route is
  // already in the URL (`/settings/profile`, `/settings/billing`, etc.)
  // fall through to the same SettingsContent the desktop uses, with the
  // `mobile` prop set so its internal layout adapts.
  if (isMobile && !params.tab) return <MobileSettingsList />;

  const activeTab = (params.tab as SettingsTabs) || SettingsTabs.Profile;

  return <SettingsContent activeTab={activeTab} mobile={isMobile} />;
});

Layout.displayName = 'SettingsLayout';

export default Layout;
