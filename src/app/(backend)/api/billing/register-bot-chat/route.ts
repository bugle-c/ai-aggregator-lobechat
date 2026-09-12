import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { userBilling } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { grantTgLinkBonus } from '@/server/modules/billing/grant-tg-link-bonus';
import { processReferralRewards } from '@/server/modules/referrals/processReferralRewards';

/**
 * POST /api/billing/register-bot-chat
 *
 * Called by the bot (@gptwebrubot) whenever a user interacts with it
 * (any update — see the bot's global middleware). It stamps the user's
 * REAL bot chat_id onto user_billing.tg_bot_chat_id.
 *
 * WHY: tg_bot_chat_id used to be set on Telegram *login* (Login Widget),
 * but a login does not create a bot chat — bots can't DM a user who never
 * pressed Start, so 93% of "linked" rows were phantom (getChat → "chat not
 * found") and recovery/notify silently failed. The source of truth for a
 * REACHABLE chat is the bot actually receiving a message from it. This
 * endpoint is how that truth flows back to the aggregator: the moment a
 * user opens/uses the bot, they become reachable.
 *
 * Identity is resolved by the user's Telegram account (better-auth
 * `accounts` row, provider_id='telegram', account_id=tg_user_id) — so we
 * can only ever stamp a chat for the user who actually owns that Telegram
 * id. Unknown tg_user_id (someone who messaged the bot but never signed up
 * on the web) → no-op.
 *
 * Since 2026-09-12 this is also where the +100 TG-link bonus and referral
 * payouts are granted: a real bot update is the only proof the chat is
 * reachable, and the bonus exists to buy exactly that. Both grants are
 * idempotent (tg_bonus_claimed_at stamp / referrals.status flip), so a user
 * who also came through tg-link-confirm is paid once.
 *
 * Auth: same X-Internal-Token shared secret as the other bot↔aggregator
 * internal routes. Idempotent.
 */
export const dynamic = 'force-dynamic';

interface Body {
  /**
   * The bot's own mapping for this Telegram user (bot.db). Used only when no
   * web `accounts` row exists — i.e. a bot-native account created by the bot
   * itself. Such users get their chat_id stamped (they are reachable by
   * definition) but NO link bonus: nothing was linked, no web account exists.
   */
  lobechat_user_id?: string;
  tg_chat_id: number;
  tg_user_id: number;
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

  if (
    !body.tg_user_id ||
    typeof body.tg_user_id !== 'number' ||
    !body.tg_chat_id ||
    typeof body.tg_chat_id !== 'number'
  ) {
    return NextResponse.json({ ok: false, error: 'bad_tg_ids' }, { status: 400 });
  }

  const db = await getServerDB();

  // Resolve the lobechat user from their Telegram account. account_id is TEXT.
  const rows = await db.execute(sql`
    SELECT user_id FROM accounts
    WHERE provider_id = 'telegram' AND account_id = ${String(body.tg_user_id)}
    LIMIT 1
  `);
  let userId = (rows.rows as Array<{ user_id: string }>)[0]?.user_id;
  // `linked` = a web account was tied to this Telegram id (bonus-eligible).
  // Bot-native accounts are reachable but were never "linked".
  let linked = true;
  if (!userId) {
    const botUserId = typeof body.lobechat_user_id === 'string' ? body.lobechat_user_id : '';
    if (!botUserId) {
      return NextResponse.json({ ok: true, linked: false, reason: 'no_account' });
    }
    const exists = await db.execute(sql`SELECT 1 FROM users WHERE id = ${botUserId} LIMIT 1`);
    if (exists.rows.length === 0) {
      return NextResponse.json({ ok: true, linked: false, reason: 'no_account' });
    }
    userId = botUserId;
    linked = false;
  }

  // Stamp the real chat id (idempotent upsert). Only overwrites if changed.
  try {
    await db
      .insert(userBilling)
      .values({ planId: 1, tgBotChatId: body.tg_chat_id, userId })
      .onConflictDoUpdate({
        target: userBilling.userId,
        set: { tgBotChatId: body.tg_chat_id, updatedAt: new Date() },
      });
  } catch (e) {
    console.error('[register-bot-chat] failed to stamp tg_bot_chat_id', e);
    return NextResponse.json({ ok: false, error: 'billing_write_failed' }, { status: 500 });
  }

  if (!linked) {
    // Bot-native account: reachable, now visible to broadcasts/push — but
    // nothing was linked, so no bonus and no referral gate here.
    return NextResponse.json({ ok: true, linked: false, reason: 'bot_native', granted: 0 });
  }

  // Reachability proven → pay the link bonus + unblock referral rewards.
  // Best-effort: the stamp above is the important side effect.
  let granted = 0;
  try {
    granted = (await grantTgLinkBonus(db, userId)).granted;
    if (granted > 0) console.info(`[register-bot-chat] +${granted} link bonus → ${userId}`);
  } catch (e) {
    console.error('[register-bot-chat] grantTgLinkBonus failed', e);
  }
  try {
    const r = await processReferralRewards(db, userId);
    if (r.awardedCount > 0)
      console.info(
        `[register-bot-chat] referral rewards: awarded=${r.awardedCount} referee=${userId}`,
      );
  } catch (e) {
    console.error('[register-bot-chat] processReferralRewards failed', e);
  }

  return NextResponse.json({ ok: true, linked: true, granted });
}
