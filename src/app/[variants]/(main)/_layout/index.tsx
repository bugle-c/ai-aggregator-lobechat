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

  // The left nav Drawer on mobile reuses the desktop `showLeftPanel` flag,
  // which defaults to `true` (desktop = nav rail expanded). On mobile that
  // default — or a persisted `true` from a desktop session — force-opens the
  // Drawer on home load. Reset it closed once when entering mobile so the
  // Drawer only ever opens via the burger (toggleLeftPanel(true)).
  useEffect(() => {
    if (isMobile && showLeftPanel) toggleLeftPanel(false);
    // Intentionally run only on the mobile transition, not on every
    // showLeftPanel change — otherwise the burger could never open it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);

  // MobileShell uses height: calc(100dvh - var(--mobile-shell-banner-offset)).
  // We measure the actual position of .ant-app relative to body top so the
  // offset reflects whatever chrome (CloudBanner, future top bars) is
  // currently above it — not just what showCloudPromotion predicts. The
  // feature flag and the rendered DOM can disagree (banner can be shown
  // by upstream logic without the flag), so measuring reality is the
  // robust choice.
  //
  // Observation strategy:
  //   - MutationObserver on body's childList catches CloudBanner / other
  //     siblings mounting and unmounting above .ant-app. This is the
  //     primary signal — banner appearance is a sibling-list change.
  //   - resize / visualViewport listeners catch URL-bar dance and
  //     orientation flips so we re-measure when the viewport changes.
  // (An earlier ResizeObserver(document.body) was useless: once we lock
  // html/body to overflow:hidden with fixed 100dvh, body never resizes
  // and the observer never fires.)
  useEffect(() => {
    if (!isMobile) return;
    const antApp = document.querySelector<HTMLElement>('.ant-app');
    if (!antApp) return;

    const update = () => {
      // .ant-app's bounding-rect top is the gap between viewport's top
      // and the shell wrapper — exactly what we subtract from 100dvh.
      const offset = antApp.getBoundingClientRect().top;
      antApp.style.setProperty(MOBILE_SHELL_BANNER_OFFSET_VAR, `${Math.max(0, offset)}px`);
    };

    update();

    const mo = new MutationObserver(update);
    mo.observe(document.body, { childList: true });

    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);

    return () => {
      mo.disconnect();
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
      antApp.style.removeProperty(MOBILE_SHELL_BANNER_OFFSET_VAR);
    };
  }, [isMobile]);

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
