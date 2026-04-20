import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const FIRST_COOKIE = 'utm_attribution_first';
const LAST_COOKIE = 'utm_attribution_last';
const FIRST_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year
const LAST_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as const;

function hasUtmParam(params: URLSearchParams): boolean {
  return UTM_KEYS.some((k) => params.has(k));
}

function buildCookiePayload(req: NextRequest): string {
  const params = req.nextUrl.searchParams;
  const payload = {
    utm_source: params.get('utm_source'),
    utm_medium: params.get('utm_medium'),
    utm_campaign: params.get('utm_campaign'),
    utm_content: params.get('utm_content'),
    referrer: req.headers.get('referer') || null,
    landing_page: req.nextUrl.pathname + req.nextUrl.search,
    seen_at: new Date().toISOString(),
  };
  return JSON.stringify(payload);
}

export function middleware(req: NextRequest) {
  const params = req.nextUrl.searchParams;

  // Fast-path: not a UTM-carrying visit and first cookie already present → do nothing.
  if (!hasUtmParam(params) && req.cookies.has(FIRST_COOKIE)) {
    return NextResponse.next();
  }

  const res = NextResponse.next();
  const payload = buildCookiePayload(req);
  const cookieOpts = {
    httpOnly: false, // readable by client for debugging; no secret data
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  };

  if (!req.cookies.has(FIRST_COOKIE)) {
    res.cookies.set(FIRST_COOKIE, payload, { ...cookieOpts, maxAge: FIRST_MAX_AGE_SECONDS });
  }
  if (hasUtmParam(params)) {
    res.cookies.set(LAST_COOKIE, payload, { ...cookieOpts, maxAge: LAST_MAX_AGE_SECONDS });
  }
  return res;
}

export const config = {
  // Don't run on API or internal routes — only on pages where a human lands.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|trpc|webapi).*)'],
};
