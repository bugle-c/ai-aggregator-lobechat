import { jwtVerify } from 'jose';
import { type NextRequest, NextResponse } from 'next/server';

import { auth } from '@/auth';
import { appEnv } from '@/envs/app';
import { authEnv } from '@/envs/auth';

const FALLBACK_RETURN_PATH = '/';

const errorRedirect = (reason: string): NextResponse => {
  const url = new URL('/auth-error', appEnv.APP_URL);
  url.searchParams.set('error', `bot_bridge_${reason}`);
  return NextResponse.redirect(url);
};

/**
 * Sign value with HMAC-SHA256 in Better Auth's `signCookieValue` format:
 * encodeURIComponent(`${value}.${base64(hmac)}`).
 * Source: node_modules/better-call/dist/crypto.cjs.
 */
const signForBetterAuth = async (value: string, secret: string): Promise<string> => {
  const subtle = globalThis.crypto.subtle;
  const key = await subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  );
  const sigBuf = await subtle.sign('HMAC', key, new TextEncoder().encode(value));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
  return encodeURIComponent(`${value}.${sigB64}`);
};

const buildSetCookieHeader = (
  name: string,
  value: string,
  opts: {
    domain?: string;
    httpOnly?: boolean;
    maxAge?: number;
    path?: string;
    sameSite?: 'lax' | 'strict' | 'none';
    secure?: boolean;
  },
): string => {
  const parts = [`${name}=${value}`];
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(opts.maxAge)}`);
  parts.push(`Path=${opts.path ?? '/'}`);
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  if (opts.secure) parts.push('Secure');
  const sameSite = opts.sameSite ?? 'lax';
  parts.push(`SameSite=${sameSite[0]!.toUpperCase()}${sameSite.slice(1)}`);
  return parts.join('; ');
};

const isSafeReturnPath = (p: unknown): p is string =>
  typeof p === 'string' && p.startsWith('/') && !p.startsWith('//');

export async function GET(req: NextRequest) {
  const authSecret = authEnv.AUTH_SECRET;
  const jwtSecret = process.env.BOT_BRIDGE_JWT_SECRET;
  if (!authSecret || !jwtSecret) return errorRedirect('server_misconfigured');

  const token = req.nextUrl.searchParams.get('t');
  if (!token) return errorRedirect('missing_token');

  let payload: { returnPath?: string; sub?: string; tgUserId?: number };
  try {
    const verified = await jwtVerify(token, new TextEncoder().encode(jwtSecret), {
      audience: 'bot-bridge',
    });
    payload = verified.payload as typeof payload;
  } catch {
    return errorRedirect('invalid_token');
  }

  const userId = payload.sub;
  if (!userId) return errorRedirect('invalid_payload');

  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.findUserById(userId);
  if (!user) return errorRedirect('user_not_found');

  const session = await ctx.internalAdapter.createSession(userId, false);
  if (!session?.token) return errorRedirect('session_create_failed');

  const signed = await signForBetterAuth(session.token, authSecret);

  const returnPath = isSafeReturnPath(payload.returnPath)
    ? payload.returnPath
    : FALLBACK_RETURN_PATH;
  const redirectUrl = new URL(returnPath, appEnv.APP_URL);
  const response = NextResponse.redirect(redirectUrl);

  const cookieName = ctx.authCookies.sessionToken.name;
  const cookieOpts = ctx.authCookies.sessionToken.options;
  const expiresMs =
    (session.expiresAt instanceof Date
      ? session.expiresAt.getTime()
      : new Date(session.expiresAt).getTime()) - Date.now();
  const maxAge = Math.max(0, Math.floor(expiresMs / 1000));

  response.headers.append(
    'Set-Cookie',
    buildSetCookieHeader(cookieName, signed, {
      domain: cookieOpts.domain,
      httpOnly: cookieOpts.httpOnly !== false,
      maxAge,
      path: cookieOpts.path ?? '/',
      sameSite: (cookieOpts.sameSite as 'lax' | 'strict' | 'none' | undefined) ?? 'lax',
      secure: cookieOpts.secure ?? cookieName.startsWith('__Secure-'),
    }),
  );

  return response;
}

export const runtime = 'nodejs';
