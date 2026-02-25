'use client';

import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { ContextMenuHost, ModalHost, ToastHost, TooltipGroup } from '@lobehub/ui';
import { domMax, LazyMotion } from 'motion/react';
import { type PropsWithChildren, useLayoutEffect } from 'react';
import { memo, Suspense } from 'react';

import { ReferralProvider } from '@/business/client/ReferralProvider';
import { LobeAnalyticsProviderWrapper } from '@/components/Analytics/LobeAnalyticsProviderWrapper';
import { DragUploadProvider } from '@/components/DragUploadZone/DragUploadProvider';
import { isDesktop } from '@/const/version';
import AuthProvider from '@/layout/AuthProvider';
import AppTheme from '@/layout/GlobalProvider/AppTheme';
import { FaviconProvider } from '@/layout/GlobalProvider/FaviconProvider';
import { GroupWizardProvider } from '@/layout/GlobalProvider/GroupWizardProvider';
import ImportSettings from '@/layout/GlobalProvider/ImportSettings';
import NextThemeProvider from '@/layout/GlobalProvider/NextThemeProvider';
import QueryProvider from '@/layout/GlobalProvider/Query';
import ServerVersionOutdatedAlert from '@/layout/GlobalProvider/ServerVersionOutdatedAlert';
import StoreInitialization from '@/layout/GlobalProvider/StoreInitialization';
import { ServerConfigStoreProvider } from '@/store/serverConfig/Provider';
import type { SPAServerConfig } from '@/types/spaServerConfig';

import Locale from './Locale';

const SPAGlobalProvider = memo<PropsWithChildren>(({ children }) => {
  useLayoutEffect(() => {
    document.getElementById('loading-screen')?.remove();
  }, []);

  const serverConfig: SPAServerConfig | undefined = window.__SERVER_CONFIG__;

  const locale = document.documentElement.lang || 'en-US';
  const isMobile =
    (serverConfig?.isMobile ?? typeof __MOBILE__ !== 'undefined') ? __MOBILE__ : false;

  return (
    <Locale defaultLang={locale}>
      <NextThemeProvider>
        <AppTheme>
          <ServerConfigStoreProvider
            featureFlags={serverConfig?.featureFlags}
            isMobile={isMobile}
            serverConfig={serverConfig?.config}
          >
            <QueryProvider>
              <AuthProvider>
                <StoreInitialization />

                {isDesktop && <ServerVersionOutdatedAlert />}
                <FaviconProvider>
                  <GroupWizardProvider>
                    <DragUploadProvider>
                      <LazyMotion features={domMax}>
                        <TooltipGroup layoutAnimation={false}>
                          <LobeAnalyticsProviderWrapper>{children}</LobeAnalyticsProviderWrapper>
                        </TooltipGroup>
                        <ModalHost />
                        <ToastHost />
                        <ContextMenuHost />
                      </LazyMotion>
                    </DragUploadProvider>
                  </GroupWizardProvider>
                </FaviconProvider>
              </AuthProvider>
            </QueryProvider>
            <Suspense>
              {ENABLE_BUSINESS_FEATURES ? <ReferralProvider /> : null}
              <ImportSettings />
              {/* DevPanel disabled in SPA: depends on node:fs */}
            </Suspense>
          </ServerConfigStoreProvider>
        </AppTheme>
      </NextThemeProvider>
    </Locale>
  );
});

SPAGlobalProvider.displayName = 'SPAGlobalProvider';

export default SPAGlobalProvider;
