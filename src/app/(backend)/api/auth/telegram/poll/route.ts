import { type NextRequest, NextResponse } from 'next/server';

import { getRedis, REDIS_KEY_PREFIX } from '@/libs/better-auth/sso/providers/telegram';

/**
 * GET: Poll auth code status.
 * Returns { status: "pending" | "confirmed" | "expired" }
 */
export const GET = async (req: NextRequest) => {
  const code = new URL(req.url).searchParams.get('code');
  if (!code) {
    return NextResponse.json({ status: 'expired' });
  }

  try {
    const redis = await getRedis();
    const raw = await redis.get(`${REDIS_KEY_PREFIX}${code}`);

    if (!raw) {
      return NextResponse.json({ status: 'expired' });
    }

    const data = JSON.parse(raw) as { status: string };
    return NextResponse.json({ status: data.status });
  } catch {
    return NextResponse.json({ status: 'expired' });
  }
};
