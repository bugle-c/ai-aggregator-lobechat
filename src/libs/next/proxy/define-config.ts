import debug from 'debug';
import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { UAParser } from 'ua-parser-js';
import urlJoin from 'url-join';

import { auth } from '@/auth';
import { LOBE_LOCALE_COOKIE } from '@/const/locale';
import { isDesktop } from '@/const/version';
import { appEnv } from '@/envs/app';
import { authEnv } from '@/envs/auth';
import { type Locales } from '@/locales/resources';
import { parseBrowserLanguage } from '@/utils/locale';
import { RouteVariants } from '@/utils/server/routeVariants';

import { createRouteMatcher } from './createRouteMatcher';

// Create debug logger instances
const logDefault = debug('middleware:default');
const logBetterAuth = debug('middleware:better-auth');

export function defineConfig() {
  const backendApiEndpoints = ['/api', '/trpc', '/webapi', '/oidc'];

  const defaultMiddleware = (request: NextRequest) => {
    const url = new URL(request.url);
    logDefault('Processing request: %s %s', request.method, request.url);

    // skip all api requests
    if (backendApiEndpoints.some((path) => url.pathname.startsWith(path))) {
      logDefault('Skipping API request: %s', url.pathname);
      return NextResponse.next();
    }

    // Referral capture: ?ref=<8-char-code> → cookie `_ref` for 30 days, then
    // 302 to clean URL. Read at signup time by `processReferralSignup`. Bad
    // codes are stripped silently (no DB call here — middleware runs per
    // request and validation against `users.referral_code` happens at
    // signup). Phase 2.1 referral program.
    const refRaw = url.searchParams.get('ref');
    if (refRaw) {
      const REF_CODE_RE = /^[a-z0-9]{8}$/;
      const ref = refRaw.toLowerCase();
      const cleanUrl = url.clone ? url.clone() : new URL(request.url);
      cleanUrl.searchParams.delete('ref');
      const response = NextResponse.redirect(cleanUrl);
      if (REF_CODE_RE.test(ref)) {
        response.cookies.set({
          httpOnly: false,
          maxAge: 60 * 60 * 24 * 30,
          name: '_ref',
          path: '/',
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
          value: ref,
        });
      }
      return response;
    }

    // locale has three levels
    // 1. search params
    // 2. cookie
    // 3. browser

    // highest priority is explicitly in search params, like ?hl=zh-CN
    const explicitlyLocale = (url.searchParams.get('hl') || undefined) as Locales | undefined;

    // if it's a new user, there's no cookie, So we need to use the fallback language parsed by accept-language
    const browserLanguage = parseBrowserLanguage(request.headers);

    const locale =
      explicitlyLocale ||
      ((request.cookies.get(LOBE_LOCALE_COOKIE)?.value || browserLanguage) as Locales);

    const ua = request.headers.get('user-agent');

    const device = new UAParser(ua || '').getDevice();

    logDefault('User preferences: %O', {
      browserLanguage,
      deviceType: device.type,
      hasCookies: {
        locale: !!request.cookies.get(LOBE_LOCALE_COOKIE)?.value,
      },
      locale,
    });

    // 2. Create normalized preference values
    const route = RouteVariants.serializeVariants({
      isMobile: device.type === 'mobile',
      locale,
    });

    logDefault('Serialized route variant: %s', route);

    // if app is in docker, rewrite to self container
    // https://github.com/lobehub/lobe-chat/issues/5876
    if (appEnv.MIDDLEWARE_REWRITE_THROUGH_LOCAL) {
      logDefault('Local container rewrite enabled: %O', {
        host: '127.0.0.1',
        original: url.toString(),
        port: process.env.PORT || '3210',
        protocol: 'http',
      });

      url.protocol = 'http';
      url.host = '127.0.0.1';
      url.port = process.env.PORT || '3210';
    }

    // refs: https://github.com/lobehub/lobe-chat/pull/5866
    // new handle segment rewrite: /${route}${originalPathname}
    // / -> /zh-CN__0
    // /discover -> /zh-CN__0/discover
    // All SPA routes that use react-router-dom should be rewritten to just /${route}
    const spaRoutes = [
      '/chat',
      '/agent',
      '/group',
      '/community',
      '/resource',
      '/eval',
      '/page',
      '/settings',
      '/image',
      '/labs',
      '/changelog',
      '/profile',
      '/me',
      '/desktop-onboarding',
      '/onboarding',
      '/share',
    ];
    const isSpaRoute = spaRoutes.some((route) => url.pathname.startsWith(route));

    let nextPathname: string;
    if (isSpaRoute) {
      nextPathname = `/${route}`;
    } else {
      nextPathname = `/${route}` + (url.pathname === '/' ? '' : url.pathname);
    }
    const nextURL = appEnv.MIDDLEWARE_REWRITE_THROUGH_LOCAL
      ? urlJoin(url.origin, nextPathname)
      : nextPathname;

    logDefault('URL rewrite: %O', {
      isLocalRewrite: appEnv.MIDDLEWARE_REWRITE_THROUGH_LOCAL,
      nextPathname,
      nextURL,
      originalPathname: url.pathname,
    });

    url.pathname = nextPathname;

    logDefault('nextURL after rewrite: %s', url.toString());
    // build rewrite response first
    const rewrite = NextResponse.rewrite(url, { status: 200 });

    // If locale explicitly provided via query (?hl=), persist it in cookie when user has no prior preference
    if (explicitlyLocale) {
      const existingLocale = request.cookies.get(LOBE_LOCALE_COOKIE)?.value as Locales | undefined;
      if (!existingLocale) {
        rewrite.cookies.set(LOBE_LOCALE_COOKIE, explicitlyLocale, {
          // 90 days is a balanced persistence for locale preference
          maxAge: 60 * 60 * 24 * 90,

          path: '/',
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
        });
        logDefault('Persisted explicit locale to cookie (no prior cookie): %s', explicitlyLocale);
      } else {
        logDefault(
          'Locale cookie exists (%s), skip overwrite with %s',
          existingLocale,
          explicitlyLocale,
        );
      }
    }

    // UTM attribution: capture first + last touch into cookies for user_attribution on signup
    const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as const;
    const hasUtm = utmKeys.some((k) => url.searchParams.has(k));
    const hasFirstCookie = request.cookies.has('utm_attribution_first');
    if (hasUtm || !hasFirstCookie) {
      const payload = JSON.stringify({
        landing_page: url.pathname + url.search,
        referrer: request.headers.get('referer') || null,
        seen_at: new Date().toISOString(),
        utm_campaign: url.searchParams.get('utm_campaign'),
        utm_content: url.searchParams.get('utm_content'),
        utm_medium: url.searchParams.get('utm_medium'),
        utm_source: url.searchParams.get('utm_source'),
      });
      const cookieOpts = {
        path: '/',
        sameSite: 'lax' as const,
        secure: process.env.NODE_ENV === 'production',
      };
      if (!hasFirstCookie) {
        rewrite.cookies.set('utm_attribution_first', payload, {
          ...cookieOpts,
          maxAge: 60 * 60 * 24 * 365, // 1 year
        });
      }
      if (hasUtm) {
        rewrite.cookies.set('utm_attribution_last', payload, {
          ...cookieOpts,
          maxAge: 60 * 60 * 24 * 30, // 30 days
        });
      }
    }

    // Pricing A/B: assign 50/50 once and lock for 180 days. Read by the
    // tRPC lambda context (libs/trpc/lambda/context.ts) and stamped on
    // every billing_payments row as metadata.pricing_variant for the
    // /admin/finance/pricing-experiments dashboard. Without this nobody
    // ever set the cookie — only 1/4 paid users had a variant pre-fix.
    const existingVariant = request.cookies.get('_pricing_variant')?.value;
    if (existingVariant !== 'A' && existingVariant !== 'B') {
      const variant: 'A' | 'B' = Math.random() < 0.5 ? 'A' : 'B';
      rewrite.cookies.set('_pricing_variant', variant, {
        httpOnly: false,
        maxAge: 60 * 60 * 24 * 180,
        path: '/',
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      });
    }

    return rewrite;
  };

  const isPublicRoute = createRouteMatcher([
    // backend api
    '/api/auth(.*)',
    '/api/webhooks(.*)',
    '/api/billing(.*)',
    '/api/workflows(.*)',
    '/api/agent(.*)',
    '/api/dev(.*)',
    '/api/cron(.*)',
    // Public read-only endpoints consumed by the marketing landing
    // (gptweb.ru). Examples: /api/public/blog-promo. Add any new
    // unauthenticated GETs under /api/public/* — they bypass the
    // sign-in gate. Do NOT put anything that mutates state here.
    '/api/public(.*)',
    '/webapi(.*)',
    '/trpc(.*)',
    // version
    '/api/version',
    '/api/desktop/(.*)',
    // better auth
    '/signin',
    '/signup',
    '/auth-error',
    '/verify-email',
    '/reset-password',
    // oauth
    // Make only the consent view public (GET page), not other oauth paths
    '/oauth/consent/(.*)',
    '/oidc/handoff',
    '/oidc/token',
    // market
    '/market-auth-callback',
    // public share pages
    '/share(.*)',
  ]);

  const betterAuthMiddleware = async (req: NextRequest) => {
    logBetterAuth('BetterAuth middleware processing request: %s %s', req.method, req.url);

    const response = defaultMiddleware(req);

    // when enable auth protection, only public route is not protected, others are all protected
    const isProtected = !isPublicRoute(req);

    logBetterAuth('Route protection status: %s, %s', req.url, isProtected ? 'protected' : 'public');

    // Skip session lookup for public routes to reduce latency
    if (!isProtected) return response;

    // Get full session with user data (Next.js 15.2.0+ feature)
    const session = await auth.api.getSession({
      headers: req.headers,
    });

    const isLoggedIn = !!session?.user;

    logBetterAuth('BetterAuth session status: %O', {
      isLoggedIn,
      userId: session?.user?.id,
    });

    if (!isLoggedIn && !isDesktop) {
      // If request a protected route, redirect to sign-in page
      if (isProtected) {
        logBetterAuth('Request a protected route, redirecting to sign-in page');
        const callbackUrl = `${appEnv.APP_URL}${req.nextUrl.pathname}${req.nextUrl.search}`;
        const signInUrl = new URL('/signin', appEnv.APP_URL);
        signInUrl.searchParams.set('callbackUrl', callbackUrl);
        const hl = req.nextUrl.searchParams.get('hl');
        if (hl) {
          signInUrl.searchParams.set('hl', hl);
          logBetterAuth('Preserving locale to sign-in: hl=%s', hl);
        }
        // Preserve UTM cookies set by defaultMiddleware across the auth redirect
        const redirectResponse = NextResponse.redirect(signInUrl);
        for (const c of response.cookies.getAll()) {
          redirectResponse.cookies.set(c);
        }
        return redirectResponse;
      }
      logBetterAuth('Request a free route but not login, allow visit without auth header');
    }

    return response;
  };

  logDefault('Middleware configuration: %O', {
    enableOIDC: authEnv.ENABLE_OIDC,
  });

  return {
    middleware: betterAuthMiddleware,
  };
}
