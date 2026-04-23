import { NextRequest, NextResponse } from 'next/server';

import {
  CREDIT_VALUE_RUB,
  DEFAULT_MODEL_RATE,
  MODEL_RATES,
  USD_TO_RUB,
} from '@/server/modules/billing/model-rates';
import {
  PLAN_MAX_TIER,
  classifyModelTier,
  getRequiredPlanForModel,
} from '@/server/modules/billing/model-tiers';
import { TIER_DAILY_CAPS } from '@/server/modules/billing/checkUsageLimit';

// Provider lookup is the same prefix map used for OpenRouter routing
// (duplicated from model-rates.ts which keeps it unexported). Keep in sync.
const PROVIDER_OF: Record<string, string> = {
  'deepseek-chat': 'deepseek',
  'deepseek-reasoner': 'deepseek',
  'gpt-5-mini': 'openai',
  'gpt-5-nano': 'openai',
  'gpt-5.1': 'openai',
  'gpt-5.2': 'openai',
  'gpt-5-chat-latest': 'openai',
  'gpt-4.1-mini': 'openai',
  'gpt-4.1': 'openai',
  'gpt-4o': 'openai',
  'gpt-4o-mini': 'openai',
  'chatgpt-4o-latest': 'openai',
  'gpt-4-turbo': 'openai',
  'o4-mini': 'openai',
  o3: 'openai',
  'gemini-2.5-flash': 'google',
  'gemini-2.5-pro': 'google',
  'gemini-3-flash-preview': 'google',
  'gemini-3-pro-preview': 'google',
  'gemini-3.1-pro-preview': 'google',
  'claude-haiku-4-5-20251001': 'anthropic',
  'claude-sonnet-4-6': 'anthropic',
  'claude-sonnet-4-5-20250929': 'anthropic',
  'claude-opus-4-6': 'anthropic',
  'claude-opus-4-5-20251101': 'anthropic',
  'grok-4': 'x-ai',
  'MiniMax-M2.5': 'minimax',
  'MiniMax-M2.5-highspeed': 'minimax',
  'MiniMax-M2.1': 'minimax',
};

function providerOf(modelId: string): string {
  if (PROVIDER_OF[modelId]) return PROVIDER_OF[modelId];
  if (modelId.includes('/')) return modelId.split('/')[0];
  return 'unknown';
}

/**
 * GET /webapi/admin/model-rates
 *
 * Returns the full catalog of priced models with their tier, provider, and
 * plan access, so the admin UI can render "what's in each tier" without
 * duplicating the catalog. Source of truth is this aggregator repo; admin
 * fetches here.
 *
 * Auth: Bearer CRON_SECRET header. Admin container already has the same
 * secret in its env, so no extra key to manage.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Dedup OpenRouter-prefixed duplicates — the catalog stores each model
  // under both "gpt-5-mini" and "openai/gpt-5-mini"; we only want the canonical
  // one for UI purposes.
  const seen = new Set<string>();
  const models = Object.entries(MODEL_RATES)
    .filter(([id]) => {
      if (id.includes('/')) return false; // skip prefixed duplicates
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map(([id, rate]) => ({
      id,
      provider: providerOf(id),
      inputPer1M: rate.inputPer1M,
      outputPer1M: rate.outputPer1M,
      tier: classifyModelTier(id),
      requiredPlan: getRequiredPlanForModel(id),
    }))
    .sort((a, b) => {
      const tierOrder = { premium: 0, high: 1, mid: 2, cheap: 3 };
      if (tierOrder[a.tier] !== tierOrder[b.tier]) {
        return tierOrder[a.tier] - tierOrder[b.tier];
      }
      return b.outputPer1M - a.outputPer1M;
    });

  return NextResponse.json({
    models,
    defaultRate: {
      inputPer1M: DEFAULT_MODEL_RATE.inputPer1M,
      outputPer1M: DEFAULT_MODEL_RATE.outputPer1M,
      tier: classifyModelTier('__unknown__'),
    },
    creditValueRub: CREDIT_VALUE_RUB,
    usdToRub: USD_TO_RUB,
    planMaxTier: PLAN_MAX_TIER,
    tierDailyCaps: TIER_DAILY_CAPS,
    counts: {
      total: models.length,
      byTier: models.reduce(
        (acc, m) => {
          acc[m.tier] = (acc[m.tier] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      ),
    },
  });
}
