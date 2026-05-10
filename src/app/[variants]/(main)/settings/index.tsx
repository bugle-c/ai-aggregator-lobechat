'use client';

import { memo } from 'react';
import { Navigate, useParams } from 'react-router-dom';

import { useIsMobile } from '@/hooks/useIsMobile';
import { SettingsTabs } from '@/store/global/initialState';

import { type LayoutProps } from './_layout/type';
import SettingsContent from './features/SettingsContent';
import MobileSettingsList from './MobileSettingsList';

// Mobile scroll context lives in `_layout/index.tsx` so every settings
// sub-route gets it for free. This file just decides what to render.
const Layout = memo<LayoutProps>(() => {
  const params = useParams<{ tab?: string }>();
  const isMobile = useIsMobile();

  // On mobile, the bare `/settings` route shows a list-of-links instead
  // of the desktop sidebar + content split. When a specific sub-route is
  // already in the URL (`/settings/profile`, `/settings/billing`, etc.)
  // fall through to the same SettingsContent the desktop uses, with the
  // `mobile` prop set so its internal layout adapts.
  if (isMobile && !params.tab) return <MobileSettingsList />;

  // Desktop fallback when the route is `/settings` with no tab — keep
  // legacy behavior (redirect URL bar to `/settings/profile`).
  if (!isMobile && !params.tab) {
    return <Navigate replace to="/settings/profile" />;
  }

  const activeTab = (params.tab as SettingsTabs) || SettingsTabs.Profile;
  return <SettingsContent activeTab={activeTab} mobile={isMobile} />;
});

Layout.displayName = 'SettingsLayout';

export default Layout;
