import { eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { userBilling } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { authEnv } from '@/envs/auth';
import { grantTgLinkBonus } from '@/server/modules/billing/grant-tg-link-bonus';
import { verifyTgLinkToken } from '@/server/modules/billing/tg-link-token';

/**
 * POST /api/billing/tg-link-confirm
 *
 * Called by the bot after a user taps the inline "Привязать" confirm
 * button. Body carries the HMAC token (minted by /tg-link-start) and
 * the user's Telegram identifiers from `ctx.from`. We verify the
 * token, derive the lobechat user_id, stamp tg_bot_chat_id on
 * user_billing, and call grantTgLinkBonus.
 *
 * Auth: same `X-Internal-Token` pattern as telegram-payment-fulfill —
 * only the bot (sharing BOT_INTERNAL_TOKEN) can call this.
 */
export const dynamic = 'force-dynamic';

interface Body {
  first_name?: string;
  tg_chat_id: number;
  tg_user_id: number;
  /** HMAC token from tg-link-start (the `link_<token>` payload tail). */
  token: string;
}

export async function POST(req: Request) {
  const internalToken = req.headers.get('x-internal-token');
  if (!process.env.BOT_INTERNAL_TOKEN || internalToken !== process.env.BOT_INTERNAL_TOKEN) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400 });
  }

  const secret = authEnv.AUTH_SECRET || process.env.AUTH_SECRET;
  if (!secret) {
    console.error('[tg-link-confirm] AUTH_SECRET missing');
    return NextResponse.json({ ok: false, error: 'server_misconfigured' }, { status: 500 });
  }

  const verified = verifyTgLinkToken(body.token, secret);
  if (!verified) {
    return NextResponse.json({ ok: false, error: 'invalid_or_expired_token' }, { status: 400 });
  }

  if (
    !body.tg_user_id ||
    typeof body.tg_user_id !== 'number' ||
    !body.tg_chat_id ||
    typeof body.tg_chat_id !== 'number'
  ) {
    return NextResponse.json({ ok: false, error: 'bad_tg_ids' }, { status: 400 });
  }

  const db = await getServerDB();

  // 1) Stamp tg_bot_chat_id on user_billing (idempotent upsert).
  try {
    await db
      .insert(userBilling)
      .values({ planId: 1, tgBotChatId: body.tg_user_id, userId: verified.userId })
      .onConflictDoUpdate({
        target: userBilling.userId,
        set: { tgBotChatId: body.tg_user_id, updatedAt: new Date() },
      });
  } catch (e) {
    console.error('[tg-link-confirm] failed to stamp tg_bot_chat_id', e);
    return NextResponse.json({ ok: false, error: 'billing_write_failed' }, { status: 500 });
  }

  // 2) Grant the +100 credits bonus (idempotent — no-op if already
  //    claimed). Returns granted=100 on first call, granted=0 thereafter.
  let granted = 0;
  let alreadyClaimed = false;
  let expiresAt: string | undefined;
  try {
    const result = await grantTgLinkBonus(db, verified.userId);
    granted = result.granted;
    alreadyClaimed = result.alreadyClaimed;
    expiresAt = result.expiresAt;
  } catch (e) {
    console.error('[tg-link-confirm] grantTgLinkBonus failed', e);
    // Continue — the link itself is the more important side effect.
  }

  // 3) Best-effort: also write the link to the bot's own sqlite via
  //    its internal endpoint, so bot↔lobechat lookups work. Bot side
  //    is owned by gptwebrubot service; failures here are non-fatal.
  const botUrl = process.env.BOT_INTERNAL_URL ?? 'http://172.21.0.1:8082';
  const botToken = process.env.BOT_INTERNAL_TOKEN;
  if (botToken) {
    try {
      await fetch(`${botUrl}/internal/link-user`, {
        body: JSON.stringify({
          first_name: body.first_name,
          lobechat_user_id: verified.userId,
          source: 'auth_signup',
          tg_chat_id: body.tg_chat_id,
          tg_user_id: body.tg_user_id,
        }),
        headers: { 'Content-Type': 'application/json', 'X-Internal-Token': botToken },
        method: 'POST',
        // Bot welcome can take a sec — don't let it block our response.
        signal: AbortSignal.timeout(5000),
      });
    } catch (e) {
      console.warn('[tg-link-confirm] bot link-user call failed (non-fatal)', e);
    }
  }

  // 4) Update user_billing
  try {
    await db
      .update(userBilling)
      .set({ updatedAt: new Date() })
      .where(eq(userBilling.userId, verified.userId));
    void sql; // ensure import isn't tree-shaken if unused
  } catch {
    // best-effort
  }

  return NextResponse.json({
    ok: true,
    granted,
    alreadyClaimed,
    expiresAt,
  });
}
