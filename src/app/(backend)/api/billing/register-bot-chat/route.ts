import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { userBilling } from '@/database/schemas';
import { getServerDB } from '@/database/server';

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
 * Auth: same X-Internal-Token shared secret as the other bot↔aggregator
 * internal routes. Idempotent.
 */
export const dynamic = 'force-dynamic';

interface Body {
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
  const userId = (rows.rows as Array<{ user_id: string }>)[0]?.user_id;
  if (!userId) {
    // Messaged the bot but isn't a registered web user — nothing to stamp.
    return NextResponse.json({ ok: true, linked: false, reason: 'no_account' });
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

  return NextResponse.json({ ok: true, linked: true });
}
