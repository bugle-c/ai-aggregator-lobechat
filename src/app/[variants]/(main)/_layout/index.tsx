'use client';

import { TITLE_BAR_HEIGHT } from '@lobechat/desktop-bridge';
import { Flexbox } from '@lobehub/ui';
import { Drawer } from 'antd';
import { cx } from 'antd-style';
import { type FC, useEffect } from 'react';
import { lazy, Suspense } from 'react';
import { HotkeysProvider } from 'react-hotkeys-hook';
import { Outlet } from 'react-router-dom';

import { DndContextWrapper } from '@/app/[variants]/(main)/resource/features/DndContextWrapper';
import Loading from '@/components/Loading/BrandTextLoading';
import { isDesktop } from '@/const/version';
import { BANNER_HEIGHT } from '@/features/AlertBanner/CloudBanner';
import DesktopFileMenuBridge from '@/features/DesktopFileMenuBridge';
import DesktopNavigationBridge from '@/features/DesktopNavigationBridge';
import AuthRequiredModal from '@/features/Electron/AuthRequiredModal';
import TitleBar from '@/features/Electron/titlebar/TitleBar';
import HotkeyHelperPanel from '@/features/HotkeyHelperPanel';
import MobileTabBar from '@/features/MobileTabBar';
import NavPanel from '@/features/NavPanel';
import { RetryModal } from '@/features/PaymentRetry';
import { TgLinkBonusGlobal } from '@/features/TgLinkBonusBanner';
import { useFeedbackModal } from '@/hooks/useFeedbackModal';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useMobileShellFlag } from '@/hooks/useMobileShellFlag';
import { usePlatform } from '@/hooks/usePlatform';
import { MarketAuthProvider } from '@/layout/AuthProvider/MarketAuth';
import CmdkLazy from '@/layout/GlobalProvider/CmdkLazy';
import dynamic from '@/libs/next/dynamic';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { HotkeyScopeEnum } from '@/types/hotkey';

import DesktopHome from '../home';
import DesktopHomeLayout from '../home/_layout';
import DesktopAutoOidcOnFirstOpen from './DesktopAutoOidcOnFirstOpen';
import DesktopLayoutContainer from './DesktopLayoutContainer';
import { MOBILE_SHELL_BANNER_OFFSET_VAR, MobileShell } from './MobileShell';
import RegisterHotkeys from './RegisterHotkeys';
import { styles } from './style';

const FeedbackModal = lazy(() => import('@/components/FeedbackModal'));

const CloudBanner = dynamic(() => import('@/features/AlertBanner/CloudBanner'));

const Layout: FC = () => {
  const { isPWA } = usePlatform();
  const { showCloudPromotion } = useServerConfigStore(featureFlagsSelectors);
  const isMobile = useIsMobile();
  const showLeftPanel = useGlobalStore(systemStatusSelectors.showLeftPanel);
  const toggleLeftPanel = useGlobalStore((s) => s.toggleLeftPanel);
  const {
    initialValues: feedbackInitialValues,
    isOpen: isFeedbackModalOpen,
    close: closeFeedbackModal,
  } = useFeedbackModal();

  const isMobileShellEnabled = useMobileShellFlag();

  // MobileShell uses height: calc(100dvh - var(--mobile-shell-banner-offset)).
  // Set the CSS variable on .ant-app when CloudBanner is visible so the
  // shell shrinks accordingly; reset when the banner hides. Skipped on
  // desktop because the shell isn't mounted there.
  useEffect(() => {
    if (!isMobile) return;
    const antApp = document.querySelector<HTMLElement>('.ant-app');
    if (!antApp) return;
    const offset = showCloudPromotion ? `${BANNER_HEIGHT}px` : '0px';
    antApp.style.setProperty(MOBILE_SHELL_BANNER_OFFSET_VAR, offset);
    return () => {
      antApp.style.removeProperty(MOBILE_SHELL_BANNER_OFFSET_VAR);
    };
  }, [isMobile, showCloudPromotion]);

  return (
    <HotkeysProvider initiallyActiveScopes={[HotkeyScopeEnum.Global]}>
      <Suspense fallback={null}>
        {isDesktop && <DesktopAutoOidcOnFirstOpen />}
        {isDesktop && <DesktopNavigationBridge />}
        {isDesktop && <DesktopFileMenuBridge />}
        {isDesktop && <AuthRequiredModal />}
        {showCloudPromotion && <CloudBanner />}
      </Suspense>

      <Suspense fallback={null}>{isDesktop && <TitleBar />}</Suspense>

      {isMobile && isMobileShellEnabled ? (
        <MobileShell>
          <Drawer
            destroyOnHidden={false}
            open={showLeftPanel}
            placement="left"
            styles={{ body: { padding: 0 } }}
            title={null}
            width={300}
            onClose={() => toggleLeftPanel(false)}
          >
            <NavPanel />
          </Drawer>
          <MobileShell.ScrollArea>
            <DndContextWrapper>
              <MarketAuthProvider isDesktop={isDesktop}>
                <DesktopHomeLayout>
                  <DesktopHome />
                </DesktopHomeLayout>
                <Suspense fallback={<Loading debugId="MobileShell > Outlet" />}>
                  <Outlet />
                </Suspense>
              </MarketAuthProvider>
            </DndContextWrapper>
          </MobileShell.ScrollArea>
          <MobileTabBar />
        </MobileShell>
      ) : (
        <>
          <DndContextWrapper>
            <Flexbox
              horizontal
              className={cx(isPWA ? styles.mainContainerPWA : styles.mainContainer)}
              width={'100%'}
              height={
                isDesktop
                  ? `calc(100% - ${TITLE_BAR_HEIGHT}px)`
                  : showCloudPromotion
                    ? `calc(100% - ${BANNER_HEIGHT}px)`
                    : '100%'
              }
            >
              {!isMobile && <NavPanel />}
              {isMobile && (
                <Drawer
                  destroyOnHidden={false}
                  open={showLeftPanel}
                  placement="left"
                  styles={{ body: { padding: 0 } }}
                  title={null}
                  width={300}
                  onClose={() => toggleLeftPanel(false)}
                >
                  <NavPanel />
                </Drawer>
              )}
              <DesktopLayoutContainer>
                <MarketAuthProvider isDesktop={isDesktop}>
                  <DesktopHomeLayout>
                    <DesktopHome />
                  </DesktopHomeLayout>
                  <Suspense fallback={<Loading debugId="DesktopMainLayout > Outlet" />}>
                    <Outlet />
                  </Suspense>
                </MarketAuthProvider>
              </DesktopLayoutContainer>
            </Flexbox>
          </DndContextWrapper>
          {/* CRITICAL: MobileTabBar must remain OUTSIDE DndContextWrapper
              to match today's React tree (the bar is a sibling, not a
              child, of DndContextWrapper in the current _layout/index.tsx
              around line 115). Putting it INSIDE would expose the bar
              and its descendants to the @dnd-kit context, which they
              currently can't see. Kill-switch must restore today's
              behaviour exactly. */}
          {isMobile && !isMobileShellEnabled && <MobileTabBar />}
        </>
      )}

      <Suspense fallback={null}>
        <HotkeyHelperPanel />
        <RegisterHotkeys />
        <CmdkLazy />
        <RetryModal />
        <TgLinkBonusGlobal />
        {isFeedbackModalOpen && (
          <Suspense fallback={null}>
            <FeedbackModal
              initialValues={feedbackInitialValues}
              open={isFeedbackModalOpen}
              onClose={closeFeedbackModal}
            />
          </Suspense>
        )}
      </Suspense>
    </HotkeysProvider>
  );
};

export default Layout;
