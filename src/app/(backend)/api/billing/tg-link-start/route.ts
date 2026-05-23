import { type NextRequest, NextResponse } from 'next/server';

import { auth } from '@/auth';
import { authEnv } from '@/envs/auth';
import { signTgLinkToken } from '@/server/modules/billing/tg-link-token';

/**
 * GET /api/billing/tg-link-start
 *
 * Banner CTA target. Mints a short-lived HMAC token tying the current
 * lobechat user_id to a 10-min expiry window, then 302's to the bot's
 * link deep-link: `https://t.me/<bot>?start=link_<token>`.
 *
 * The bot's /start handler decodes the token and POSTs to
 * /api/billing/tg-link-confirm with both user IDs; that endpoint
 * actually does the linkage + bonus grant.
 *
 * Bot username is env-configured (AUTH_TELEGRAM_BOT_USERNAME). Falls
 * back to `gptwebrubot` for safety if missing.
 */
export const dynamic = 'force-dynamic';

const BOT_USERNAME = process.env.AUTH_TELEGRAM_BOT_USERNAME || 'gptwebrubot';
const TOKEN_TTL_SEC = 10 * 60;

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user?.id) {
    // Not logged in — bounce them to the sign-in page so the back-link
    // works after they auth.
    return NextResponse.redirect(new URL('/?auth=signin', req.url));
  }

  const secret = authEnv.AUTH_SECRET || process.env.AUTH_SECRET;
  if (!secret) {
    console.error('[tg-link-start] AUTH_SECRET missing');
    return NextResponse.redirect(new URL('/?tg_link_error=server_misconfigured', req.url));
  }

  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC;
  const token = signTgLinkToken({ userId: session.user.id, exp }, secret);

  const deepLink = `https://t.me/${BOT_USERNAME}?start=link_${token}`;
  return NextResponse.redirect(deepLink, 302);
}
