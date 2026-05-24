/**
 * Capture `?ref=CODE` on direct visits to ask.gptweb.ru. Sets the `_ref`
 * cookie (8-char lowercase alnum) and 302's to the same URL without the
 * query param so it doesn't pollute history. The cookie is read later by
 * processReferralSignup() in the Better Auth user.create.after hook.
 *
 * Cookie config:
 *   - 30-day TTL (matches reward expiry).
 *   - sameSite=lax so it survives the cross-tab signup form submit.
 *   - secure on https.
 *   - httpOnly to keep JS off it.
 *
 * Anything other than the `ref` param is untouched.
 */
import { type NextRequest, NextResponse } from 'next/server';

const COOKIE_NAME = '_ref';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

export function middleware(req: NextRequest) {
  const ref = req.nextUrl.searchParams.get('ref');
  if (!ref) return NextResponse.next();

  // Validate shape — same regex onSignup uses to read the cookie.
  if (!/^[a-z0-9]{8}$/i.test(ref)) return NextResponse.next();

  const cleanUrl = req.nextUrl.clone();
  cleanUrl.searchParams.delete('ref');
  const res = NextResponse.redirect(cleanUrl, 302);
  res.cookies.set(COOKIE_NAME, ref.toLowerCase(), {
    httpOnly: true,
    maxAge: COOKIE_MAX_AGE,
    path: '/',
    sameSite: 'lax',
    secure: true,
  });
  return res;
}

// Only run on paths likely to carry `?ref=` — root + a few entry routes.
// Avoid running on tRPC / API / Next internals.
export const config = {
  matcher: ['/', '/((?!api|trpc|_next|favicon|robots|sitemap|images|fonts|admin).*)'],
};
