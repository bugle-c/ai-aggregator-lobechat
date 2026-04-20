import { getModelRate } from './model-rates';

export type ModelTier = 'cheap' | 'mid' | 'high' | 'premium';
export type PlanSlug = 'free' | 'basic' | 'pro';

// Tier classification based on output token price (the expensive half).
export function classifyModelTier(modelId: string): ModelTier {
  const rate = getModelRate(modelId);
  const out = rate.outputPer1M;
  if (out <= 1) return 'cheap';
  if (out <= 5) return 'mid';
  if (out <= 15) return 'high';
  return 'premium';
}

// Each plan gets everything UP TO its tier (inclusive).
export const PLAN_MAX_TIER: Record<PlanSlug, ModelTier> = {
  basic: 'mid',
  free: 'cheap',
  pro: 'premium',
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
  return 'pro';
}
