import crypto from 'node:crypto';

import { sql } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

import { auth } from '@/auth';
import { getServerDB } from '@/database/server';

/**
 * GET /api/billing/tg-link-start
 *
 * Banner CTA target. Mints a SHORT opaque code tying the current lobechat
 * user_id to a 10-min window (stored in tg_link_codes), then 302's to the
 * bot deep-link: `https://t.me/<bot>?start=link_<code>`.
 *
 * WHY a code and not a signed token: Telegram's /start deep-link param is
 * capped at 64 chars and only allows [A-Za-z0-9_-]. The old HMAC token was
 * 127 chars and contained a '.', so the deep link was always malformed and
 * the link silently never completed. A 22-char base64url code fits both
 * limits. The bot sends the code to /api/billing/tg-link-confirm, which
 * resolves the user, stamps the chat + grants the bonus, and burns the code.
 *
 * Bot username is env-configured (AUTH_TELEGRAM_BOT_USERNAME). Falls back to
 * `gptwebrubot` for safety if missing.
 */
export const dynamic = 'force-dynamic';

const BOT_USERNAME = process.env.AUTH_TELEGRAM_BOT_USERNAME || 'gptwebrubot';
const TTL_SEC = 10 * 60;

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user?.id) {
    // Not logged in — bounce them to sign-in so the back-link works after auth.
    return NextResponse.redirect(new URL('/?auth=signin', req.url));
  }

  // 16 random bytes → 22 base64url chars (A-Za-z0-9_-), well within Telegram's
  // 64-char start-param limit. `link_` + 22 = 27 chars.
  const code = crypto.randomBytes(16).toString('base64url');

  try {
    const db = await getServerDB();
    await db.execute(sql`
      INSERT INTO tg_link_codes (code, user_id, expires_at)
      VALUES (${code}, ${session.user.id}, now() + ${`${TTL_SEC} seconds`}::interval)
    `);
  } catch (e) {
    console.error('[tg-link-start] failed to store link code', e);
    return NextResponse.redirect(new URL('/?tg_link_error=server_error', req.url));
  }

  return NextResponse.redirect(`https://t.me/${BOT_USERNAME}?start=link_${code}`, 302);
}
