import { getServerDB } from '@/database/core/db-adaptor';
import { expireSubscriptions } from '@/server/modules/analytics/expireSubscriptions';

export async function POST(req: Request) {
  const auth = req.headers.get('authorization');
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  const db = await getServerDB();
  const written = await expireSubscriptions(db);
  return Response.json({ written });
}
