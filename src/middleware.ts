/**
 * Next.js root middleware — populate the `_pricing_variant` cookie.
 *
 * Why: lambda tRPC context (`src/libs/trpc/lambda/context.ts`) reads
 * `_pricing_variant` and stamps it on every payment as
 * `metadata.pricing_variant` so /admin/finance/pricing-experiments can
 * compare A vs B conversion. Until now nobody ever SET that cookie —
 * the audit found only 1 of 4 succeeded payments had it (probably one
 * test user with a manually-set cookie). Without this middleware the
 * A/B test silently runs at sample-size 0 and pricing-experiments page
 * is meaningless.
 *
 * What it does: on every page request, if the cookie is missing or has
 * a value other than `A`/`B`, deterministically pick one based on a
 * coin flip and set it on the response with a 180-day expiry. We
 * intentionally do NOT key by user id — A/B should stick from first
 * visit (anonymous → signup → payment) so attribution captures the
 * variant the user actually saw on landing.
 *
 * Scope: skip API routes, asset paths, and webhooks — they don't
 * render pricing UI so they don't need a variant assignment, and
 * polluting fetch responses with Set-Cookie headers messes with caching.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const COOKIE_NAME = '_pricing_variant';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 180; // 180 days

export function middleware(req: NextRequest) {
  const existing = req.cookies.get(COOKIE_NAME)?.value;
  if (existing === 'A' || existing === 'B') {
    return NextResponse.next();
  }

  const variant: 'A' | 'B' = Math.random() < 0.5 ? 'A' : 'B';
  const res = NextResponse.next();
  res.cookies.set({
    name: COOKIE_NAME,
    value: variant,
    maxAge: COOKIE_MAX_AGE,
    path: '/',
    sameSite: 'lax',
    httpOnly: false, // readable by client analytics if we wire any later
  });
  return res;
}

export const config = {
  // Run on user-facing pages only; skip /api, /_next, files with extensions,
  // and known webhook paths. The cookie is consumed when the tRPC payment
  // mutation fires, by which time the page request that set it has long
  // since responded and the cookie is in the browser.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)'],
};
