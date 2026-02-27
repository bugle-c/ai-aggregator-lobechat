import { type NextRequest, NextResponse } from 'next/server';

import { authEnv } from '@/envs/auth';
import {
  CODE_TTL_SECONDS,
  getRedis,
  REDIS_KEY_PREFIX,
} from '@/libs/better-auth/sso/providers/telegram';

/**
 * POST: Bot confirms auth code with user data.
 * Auth: Bearer token must match AUTH_TELEGRAM_BOT_TOKEN.
 * Body: { code: string, user: { id, first_name, last_name?, username?, photo_url? } }
 */
export const POST = async (req: NextRequest) => {
  // Verify bearer token
  const authHeader = req.headers.get('authorization');
  const expectedToken = authEnv.AUTH_TELEGRAM_BOT_TOKEN;
  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as {
    code?: string;
    user?: {
      first_name?: string;
      id: number;
      last_name?: string;
      photo_url?: string;
      username?: string;
    };
  };

  if (!body.code || !body.user?.id) {
    return NextResponse.json({ error: 'Missing code or user data' }, { status: 400 });
  }

  const redis = await getRedis();
  const key = `${REDIS_KEY_PREFIX}${body.code}`;
  const raw = await redis.get(key);

  if (!raw) {
    return NextResponse.json({ error: 'Code expired or invalid' }, { status: 404 });
  }

  const data = JSON.parse(raw) as { status: string };
  if (data.status !== 'pending') {
    return NextResponse.json({ error: 'Code already used' }, { status: 409 });
  }

  // Update with confirmed user data, preserve remaining TTL
  const ttl = await redis.ttl(key);
  const confirmedData = {
    first_name: body.user.first_name,
    id: body.user.id,
    last_name: body.user.last_name,
    photo_url: body.user.photo_url,
    status: 'confirmed',
    username: body.user.username,
  };

  await redis.set(key, JSON.stringify(confirmedData), {
    ex: ttl > 0 ? ttl : CODE_TTL_SECONDS,
  });

  return NextResponse.json({ ok: true });
};
