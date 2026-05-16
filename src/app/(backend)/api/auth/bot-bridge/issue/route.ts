import { and, eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { type NextRequest, NextResponse } from 'next/server';

import { auth } from '@/auth';
import { account } from '@/database/schemas/betterAuth';
import { users } from '@/database/schemas/user';
import { serverDB } from '@/database/server';
import { appEnv } from '@/envs/app';
import { authEnv } from '@/envs/auth';

const TG_EMAIL_DOMAIN = 'bot.gptweb.ru';
const DEFAULT_TTL_SEC = 300;

type IssueBody = {
  mode?: 'deeplink' | 'session_token';
  returnPath?: string;
  scope?: string;
  tgUserId?: number;
  ttlSec?: number;
};

const json = (body: unknown, status: number) => NextResponse.json(body, { status });

/**
 * Sign an arbitrary value with HMAC-SHA256 using AUTH_SECRET in the exact
 * format Better Auth's `signCookieValue` produces, so the resulting string can
 * be sent as the value of `__Secure-better-auth.session_token` and pass
 * `getSignedCookie` verification.
 *
 * Format: encodeURIComponent(`${value}.${base64(hmac)}`)
 * Source: node_modules/better-call/dist/crypto.cjs (signCookieValue / makeSignature)
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

const lookupUserByTgId = async (tgUserId: number) => {
  // Primary path: Telegram-linked Better Auth account (provider_id='telegram',
  // account_id=<tgUserId>). Covers users who linked TG via OAuth/Login Widget
  // regardless of their primary email/Google/etc. account.
  const [byAccount] = await serverDB
    .select({ id: account.userId })
    .from(account)
    .where(and(eq(account.providerId, 'telegram'), eq(account.accountId, String(tgUserId))))
    .limit(1);
  if (byAccount) return { id: byAccount.id };

  // Fallback: synthetic-email users created via /api/auth/telegram/confirm
  // (older bot-only signup path).
  const email = `tg_${tgUserId}@${TG_EMAIL_DOMAIN}`;
  const [byEmail] = await serverDB
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return byEmail ?? null;
};

const handleDeeplink = async (body: IssueBody, jwtSecret: string): Promise<NextResponse> => {
  const { tgUserId, scope, returnPath, ttlSec } = body;
  if (typeof tgUserId !== 'number' || !scope || !returnPath) {
    return json({ error: 'missing_fields' }, 400);
  }
  const user = await lookupUserByTgId(tgUserId);
  if (!user) return json({ error: 'user_not_found' }, 404);

  const ttl = Math.max(30, Math.min(ttlSec ?? DEFAULT_TTL_SEC, 900));
  const token = await new SignJWT({ returnPath, scope, tgUserId, userId: user.id })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .setSubject(user.id)
    .setAudience('bot-bridge')
    .sign(new TextEncoder().encode(jwtSecret));

  const url = `${appEnv.APP_URL}/api/auth/bot-bridge/consume?t=${encodeURIComponent(token)}`;
  return json({ token, url }, 200);
};

const handleSessionToken = async (body: IssueBody, authSecret: string): Promise<NextResponse> => {
  const { tgUserId } = body;
  if (typeof tgUserId !== 'number') {
    return json({ error: 'missing_fields' }, 400);
  }
  const user = await lookupUserByTgId(tgUserId);
  if (!user) return json({ error: 'user_not_found' }, 404);

  const ctx = await auth.$context;
  const session = await ctx.internalAdapter.createSession(user.id, false);
  if (!session?.token) return json({ error: 'session_create_failed' }, 500);

  const sessionToken = await signForBetterAuth(session.token, authSecret);
  const expiresAt =
    session.expiresAt instanceof Date
      ? session.expiresAt.toISOString()
      : new Date(session.expiresAt).toISOString();

  return json({ expiresAt, sessionToken }, 200);
};

export async function POST(req: NextRequest) {
  const bridgeSecret = process.env.BOT_BRIDGE_SECRET;
  const jwtSecret = process.env.BOT_BRIDGE_JWT_SECRET;
  const authSecret = authEnv.AUTH_SECRET;

  if (!bridgeSecret || !jwtSecret || !authSecret) {
    return json({ error: 'server_misconfigured' }, 500);
  }

  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${bridgeSecret}`) {
    return json({ error: 'unauthorized' }, 401);
  }

  let body: IssueBody;
  try {
    body = (await req.json()) as IssueBody;
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  if (body.mode === 'deeplink') return handleDeeplink(body, jwtSecret);
  if (body.mode === 'session_token') return handleSessionToken(body, authSecret);
  return json({ error: 'invalid_mode' }, 400);
}

export const runtime = 'nodejs';
