import './initialize';

import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { type ResolvingViewport } from 'next';
import Script from 'next/script';
import { type ReactNode } from 'react';
import { Suspense } from 'react';
import { isRtlLang } from 'rtl-detect';

import BusinessGlobalProvider from '@/business/client/BusinessGlobalProvider';
import Analytics from '@/components/Analytics';
import { DEFAULT_LANG } from '@/const/locale';
import { isDesktop } from '@/const/version';
import AuthProvider from '@/layout/AuthProvider';
import GlobalProvider from '@/layout/GlobalProvider';
import { type Locales } from '@/locales/resources';
import { type DynamicLayoutProps } from '@/types/next';
import { RouteVariants } from '@/utils/server/routeVariants';

const inVercel = process.env.VERCEL === '1';

const vpnPromoUrl = 'https://t.me/freeip_pashavinbot';

const VpnPromoStrip = () => (
  <a
    aria-label="Бесплатный VPN — открыть Telegram-бота"
    data-testid="vpn-pashavin-top-strip"
    href={vpnPromoUrl}
    rel="noopener noreferrer"
    target="_blank"
    style={{
      alignItems: 'center',
      backdropFilter: 'blur(14px)',
      background: 'rgba(8, 13, 24, 0.72)',
      borderBottom: '1px solid rgba(148, 163, 184, 0.16)',
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
      color: 'rgba(226, 232, 240, 0.86)',
      display: 'flex',
      fontSize: 12,
      gap: 8,
      height: 28,
      justifyContent: 'center',
      left: 0,
      letterSpacing: '0.01em',
      lineHeight: '28px',
      position: 'fixed',
      right: 0,
      textDecoration: 'none',
      top: 0,
      zIndex: 2147483000,
    }}
  >
    <span style={{ color: 'rgba(34, 211, 238, 0.9)', fontWeight: 600 }}>Бесплатный VPN</span>
    <span style={{ opacity: 0.76 }}>стабильный доступ к нейросетям и рабочим сервисам</span>
    <span style={{ color: 'rgba(125, 211, 252, 0.95)', fontWeight: 600 }}>
      t.me/freeip_pashavinbot
    </span>
  </a>
);

export interface RootLayoutProps extends DynamicLayoutProps {
  children: ReactNode;
}

const RootLayout = async ({ children, params }: RootLayoutProps) => {
  const { variants } = await params;

  const { locale, isMobile, primaryColor, neutralColor } =
    RouteVariants.deserializeVariants(variants);

  const direction = isRtlLang(locale) ? 'rtl' : 'ltr';

  const renderContent = () => {
    return (
      <GlobalProvider
        isMobile={isMobile}
        locale={locale}
        neutralColor={neutralColor}
        primaryColor={primaryColor}
        variants={variants}
      >
        <AuthProvider>{children}</AuthProvider>
      </GlobalProvider>
    );
  };

  return (
    <html suppressHydrationWarning dir={direction} lang={locale}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(${outdateBrowserScript.toString()})();` }} />
        {process.env.DEBUG_REACT_SCAN === '1' && (
          <Script
            crossOrigin={'anonymous'}
            src={'https://unpkg.com/react-scan/dist/auto.global.js'}
            strategy={'lazyOnload'}
          />
        )}
      </head>
      <body>
        <VpnPromoStrip />
        {ENABLE_BUSINESS_FEATURES ? (
          <BusinessGlobalProvider>{renderContent()}</BusinessGlobalProvider>
        ) : (
          renderContent()
        )}
        <Suspense fallback={null}>
          <Analytics />
          {inVercel && <SpeedInsights />}
        </Suspense>
        {/*
          Yandex Metrika 106801684 — same counter as gptweb.ru landing.
          Lets attribution flow as a single funnel: a visit that lands on
          gptweb.ru with utm_source=yandex and walks to ask.gptweb.ru/register
          shows up as one session in Metrika reports. Initialised with
          `trackHash` and `trackLinks` so SPA navigation inside the
          aggregator is logged automatically.
        */}
        <Script id="yandex-metrika-aggregator" strategy="afterInteractive">{`
          (function(m,e,t,r,i,k,a){
            m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
            m[i].l=1*new Date();
            for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}
            k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)
          })(window,document,'script','https://mc.yandex.ru/metrika/tag.js?id=106801684','ym');
          ym(106801684,'init',{ssr:true,webvisor:true,clickmap:true,trackHash:true,accurateTrackBounce:true,trackLinks:true});
        `}</Script>
        <noscript>
          <div>
            <img
              alt=""
              src="https://mc.yandex.ru/watch/106801684"
              style={{ position: 'absolute', left: '-9999px' }}
            />
          </div>
        </noscript>
      </body>
    </html>
  );
};

function outdateBrowserScript() {
  function supportsImportMaps(): boolean {
    return (
      typeof HTMLScriptElement !== 'undefined' &&
      typeof (HTMLScriptElement as any).supports === 'function' &&
      (HTMLScriptElement as any).supports('importmap')
    );
  }

  function supportsCascadeLayers(): boolean {
    if (typeof document === 'undefined') return false;

    const el = document.createElement('div');
    el.className = '__layer_test__';
    el.style.position = 'absolute';
    el.style.left = '-99999px';
    el.style.top = '-99999px';

    const style = document.createElement('style');
    style.textContent = `
      @layer a, b;
      @layer a { .__layer_test__ { color: rgb(1, 2, 3); } }
      @layer b { .__layer_test__ { color: rgb(4, 5, 6); } }
    `;

    document.documentElement.append(style);
    document.documentElement.append(el);

    const color = getComputedStyle(el).color;

    el.remove();
    style.remove();

    return color === 'rgb(4, 5, 6)';
  }

  const isOutdateBrowser = !(supportsImportMaps() && supportsCascadeLayers());
  if (isOutdateBrowser) {
    window.location.href = '/not-compatible.html';
    return true;
  }
  return false;
}

export default RootLayout;

export { generateMetadata } from './metadata';

export const generateViewport = async (props: DynamicLayoutProps): ResolvingViewport => {
  const isMobile = await RouteVariants.getIsMobile(props);

  const dynamicScale = isMobile ? { maximumScale: 1, userScalable: false } : {};

  return {
    ...dynamicScale,
    colorScheme: null,
    initialScale: 1,
    minimumScale: 1,
    themeColor: [
      { color: '#f8f8f8', media: '(prefers-color-scheme: light)' },
      { color: '#000', media: '(prefers-color-scheme: dark)' },
    ],
    viewportFit: 'cover',
    width: 'device-width',
  };
};

export const generateStaticParams = () => {
  const mobileOptions = isDesktop ? [false] : [true, false];
  // only static for several page, other go to dynamic
  const staticLocales: Locales[] = [DEFAULT_LANG, 'zh-CN'];

  const variants: { variants: string }[] = [];

  for (const locale of staticLocales) {
    for (const isMobile of mobileOptions) {
      variants.push({
        variants: RouteVariants.serializeVariants({
          isMobile,
          locale,
        }),
      });
    }
  }

  return variants;
};
