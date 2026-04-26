/**
 * Next.js root middleware.
 *
 * Currently only handles ONE concern: capture the `?ref=<code>` query param
 * (referral landing) into a `_ref` cookie, then 302-redirect to a clean URL.
 * If/when more middleware concerns are added (auth, locale, A/B), this file
 * is the place to compose them.
 *
 * The cookie is read at signup time by `processReferralSignup` (called from
 * Better Auth's databaseHooks.user.create.after). 30-day TTL gives multi-day
 * shopping behavior a chance to convert without leaking attribution forever.
 */
import { type NextRequest, NextResponse } from 'next/server';

const REF_COOKIE_NAME = '_ref';
const REF_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days
const REF_CODE_RE = /^[a-z0-9]{8}$/;

export function middleware(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const refRaw = searchParams.get('ref');

  // No `?ref=` → fall through. The matcher below already excludes static
  // assets, but we exit fast for any other navigation that doesn't carry the
  // param so we don't add latency.
  if (!refRaw) {
    return NextResponse.next();
  }

  // Validate shape — 8-char [a-z0-9]. Garbage codes are dropped silently.
  // No DB call here on purpose: middleware runs on the edge / per request,
  // and validation against `users.referral_code` happens at signup time
  // anyway. A bad code in the cookie just means "no referral" — not a bug.
  const ref = refRaw.toLowerCase();

  if (!REF_CODE_RE.test(ref)) {
    // Strip the bad param and redirect; no cookie set.
    const cleanUrl = request.nextUrl.clone();
    cleanUrl.searchParams.delete('ref');
    return NextResponse.redirect(cleanUrl);
  }

  // Build a clean URL (param stripped) and redirect, attaching the cookie.
  const cleanUrl = request.nextUrl.clone();
  cleanUrl.searchParams.delete('ref');
  const response = NextResponse.redirect(cleanUrl);
  response.cookies.set({
    name: REF_COOKIE_NAME,
    value: ref,
    maxAge: REF_COOKIE_MAX_AGE_SECONDS,
    path: '/',
    httpOnly: false, // readable client-side too in case we want analytics
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  return response;
}

export const config = {
  // Run middleware everywhere except API routes, Next internals, and static
  // assets. The matcher pattern below is the standard "skip _next, api,
  // favicon, and public files" recipe.
  matcher: ['/((?!api|trpc|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
};
