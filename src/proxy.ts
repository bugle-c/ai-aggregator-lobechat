import { defineConfig } from '@/libs/next/proxy/define-config';

const { middleware } = defineConfig();

// required to be literal
export const config = {
  matcher: [
    // include any files in the api or trpc folders that might have an extension
    '/(api|trpc|webapi)(.*)',
    // include the /
    '/',
    '/community',
    '/community(.*)',
    '/labs',
    '/eval',
    '/eval(.*)',
    '/agent',
    '/agent(.*)',
    '/group',
    '/group(.*)',
    '/changelog(.*)',
    '/settings(.*)',
    '/image',
    '/resource',
    '/resource(.*)',
    '/profile(.*)',
    '/page',
    '/page(.*)',
    '/me',
    '/me(.*)',
    '/share(.*)',
    '/desktop-onboarding',
    '/desktop-onboarding(.*)',
    '/onboarding',

    '/signup(.*)',
    '/signin(.*)',
    // Legacy auth URLs — middleware redirects /register → /?auth=signup
    // and /login → /?auth=signin. Must be in matcher or middleware never fires.
    '/register(.*)',
    '/login(.*)',
    '/verify-email(.*)',
    '/reset-password(.*)',
    '/auth-error(.*)',
    '/oauth(.*)',
    '/oidc(.*)',
    '/market-auth-callback(.*)',
  ],
};

export default middleware;
