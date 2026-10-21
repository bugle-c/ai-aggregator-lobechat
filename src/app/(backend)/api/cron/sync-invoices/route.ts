/**
 * Provider expense reconciliation. Actuals are imported only from exact upstream
 * evidence. Local usage sums are estimates, not independent invoices. Missing
 * scope/access never overwrites archived finance rows with zero.
 */
import { getServerDB } from '@/database/server';
import { reconcileWaveSpeedExpenses } from '@/server/services/billing/provider-expenses';

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  const results: Array<Record<string, unknown>> = [];
  const key = process.env.WAVESPEED_API_KEY;
  if (!key) {
    results.push({ provider: 'wavespeed', ok: false, reason: 'WAVESPEED_API_KEY not configured' });
  } else {
    try {
      const db = await getServerDB();
      const reconciliation = await reconcileWaveSpeedExpenses(db, key);
      results.push({
        provider: 'wavespeed', ok: true, ...reconciliation,
        invoiceStatus: reconciliation.daily.length > 0 ? 'verified_scoped_actuals' : 'pending',
        scope: 'exact_application_predictions',
      });
    } catch (error) {
      results.push({ provider: 'wavespeed', ok: false, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  results.push({
    provider: 'openrouter', ok: false, status: 'access_required',
    reason: 'Independent key-scoped provider report required; inference-key activity access returned HTTP403. No local usage sum imported as invoice.',
  });
  return Response.json({
    ok: results.every((result) => result.ok), results,
    invoiceStatus: 'unresolved',
    reason: 'WaveSpeed scoped actuals and per-day coverage are returned separately. Independent OpenRouter invoice access remains unresolved.',
  });
}
