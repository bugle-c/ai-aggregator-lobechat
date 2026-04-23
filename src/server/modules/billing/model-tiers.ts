import { MODEL_RATES, getModelRate } from './model-rates';

export type ModelTier = 'cheap' | 'mid' | 'high' | 'premium';
export type PlanSlug = 'free' | 'basic' | 'pro' | 'pro_max';

// Tier classification based on output token price (the expensive half).
export function classifyModelTier(modelId: string): ModelTier {
  const rate = getModelRate(modelId);
  const out = rate.outputPer1M;
  if (out <= 1) return 'cheap';
  if (out <= 5) return 'mid';
  if (out <= 15) return 'high';
  return 'premium';
}

let _modelsByTierCache: Record<ModelTier, string[]> | null = null;

/**
 * Return all catalog model IDs classified into the given tier. Used by
 * checkUsageLimit to sum cross-provider spend for per-tier daily caps —
 * previously the cap was hardcoded to `claude-opus-*` which missed GPT-4
 * Turbo, future Opus versions, and anything routed via OpenRouter.
 */
export function getModelsByTier(tier: ModelTier): string[] {
  if (!_modelsByTierCache) {
    const buckets: Record<ModelTier, string[]> = {
      cheap: [],
      high: [],
      mid: [],
      premium: [],
    };
    for (const id of Object.keys(MODEL_RATES)) {
      buckets[classifyModelTier(id)].push(id);
    }
    _modelsByTierCache = buckets;
  }
  return _modelsByTierCache[tier];
}

// Each plan gets everything UP TO its tier (inclusive). Pro historically
// included premium (Opus) but a single session could burn the entire monthly
// revenue — since 2026-04-23 Opus is gated to Pro Max only.
export const PLAN_MAX_TIER: Record<PlanSlug, ModelTier> = {
  basic: 'mid',
  free: 'cheap',
  pro: 'high', // was 'premium' before Pro Max split
  pro_max: 'premium',
};

const TIER_ORDER: ModelTier[] = ['cheap', 'mid', 'high', 'premium'];

export function isModelAllowedForPlan(modelId: string, planSlug: string): boolean {
  const planTier = PLAN_MAX_TIER[planSlug as PlanSlug] ?? 'cheap';
  const modelTier = classifyModelTier(modelId);
  return TIER_ORDER.indexOf(modelTier) <= TIER_ORDER.indexOf(planTier);
}

export function getRequiredPlanForModel(modelId: string): PlanSlug {
  const tier = classifyModelTier(modelId);
  if (tier === 'cheap') return 'free';
  if (tier === 'mid') return 'basic';
  if (tier === 'high') return 'pro';
  return 'pro_max';
}
