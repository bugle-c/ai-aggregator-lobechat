import { type NextRequest, NextResponse } from 'next/server';

import { auth } from '@/auth';

/**
 * Progressive-enhancement entry point for OAuth sign-in.
 *
 * The AuthModal's Yandex/Telegram buttons are React `<button>`s whose
 * `onClick` calls Better Auth client `signIn.oauth2()`. That requires
 * the whole LobeChat client tree to hydrate first — antd, i18next,
 * Zustand stores, tRPC — which takes 20-30s on cold load and leaves
 * clicks dead until then.
 *
 * This route is the no-JS fallback. The buttons render as `<a href>`
 * pointing here; if hydration has happened, `onClick` preventDefault's
 * and uses the in-browser flow (faster, no full page reload). If not,
 * the anchor navigates here and the server kicks off the OAuth flow
 * directly: call `auth.api.signInWithOAuth2` with `asResponse:true`,
 * extract the redirect URL + state cookies, and issue a 302.
 */
const ALLOWED_PROVIDERS = new Set(['yandex', 'telegram']);

export const GET = async (req: NextRequest) => {
  const provider = req.nextUrl.searchParams.get('provider');
  const callbackURL = req.nextUrl.searchParams.get('callbackURL') ?? '/';

  if (!provider || !ALLOWED_PROVIDERS.has(provider)) {
    return NextResponse.redirect(new URL('/?auth=signin&error=invalid_provider', req.url));
  }

  try {
    const apiResponse = await auth.api.signInWithOAuth2({
      asResponse: true,
      body: { callbackURL, providerId: provider },
      headers: req.headers,
    });

    if (apiResponse.status < 200 || apiResponse.status >= 300) {
      console.error('[oauth-start] non-2xx from signInWithOAuth2', apiResponse.status);
      return NextResponse.redirect(new URL('/?auth=signin&error=oauth_init_failed', req.url));
    }

    const data = (await apiResponse.json()) as { url?: string; redirect?: boolean };
    if (!data?.url) {
      console.error('[oauth-start] no url in response', data);
      return NextResponse.redirect(new URL('/?auth=signin&error=oauth_no_url', req.url));
    }

    // Forward Set-Cookie headers from Better Auth (state, codeVerifier, etc.)
    // — otherwise the OAuth callback will reject the request as CSRF.
    const redirectRes = NextResponse.redirect(data.url, 302);
    const setCookies = apiResponse.headers.getSetCookie?.() ?? [];
    for (const cookie of setCookies) {
      redirectRes.headers.append('set-cookie', cookie);
    }
    return redirectRes;
  } catch (e) {
    console.error('[oauth-start]', provider, e);
    return NextResponse.redirect(new URL('/?auth=signin&error=oauth_exception', req.url));
  }
};
