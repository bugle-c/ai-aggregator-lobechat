import {
  fetchAllRates,
  fetchRate,
  invalidateRatesCache as invalidateSource,
  type RateView,
} from '@/server/services/billing/rates-source';

import { classifyTierFromRate, type ModelTier } from './compute-cost';

export type { ModelTier };
export type PlanSlug = 'free' | 'basic' | 'pro' | 'pro_max';

function tierFromRate(rate: RateView): ModelTier {
  return classifyTierFromRate(rate);
}

export async function classifyModelTierAsync(modelId: string): Promise<ModelTier> {
  const rate = await fetchRate(modelId);
  if (!rate) return 'premium'; // conservative default when catalog is silent
  return tierFromRate(rate);
}

export const PLAN_MAX_TIER: Record<PlanSlug, ModelTier> = {
  basic: 'mid',
  free: 'cheap',
  pro: 'high',
  pro_max: 'premium',
};

const TIER_ORDER: ModelTier[] = ['cheap', 'mid', 'high', 'premium'];

export async function isModelAllowedForPlanAsync(
  modelId: string,
  planSlug: string,
): Promise<boolean> {
  const planTier = PLAN_MAX_TIER[planSlug as PlanSlug] ?? 'cheap';
  const modelTier = await classifyModelTierAsync(modelId);
  return TIER_ORDER.indexOf(modelTier) <= TIER_ORDER.indexOf(planTier);
}

export async function getRequiredPlanForModelAsync(modelId: string): Promise<PlanSlug> {
  const tier = await classifyModelTierAsync(modelId);
  if (tier === 'cheap') return 'free';
  if (tier === 'mid') return 'basic';
  if (tier === 'high') return 'pro';
  return 'pro_max';
}

export async function getModelsByTierAsync(tier: ModelTier): Promise<string[]> {
  const rates = await fetchAllRates();
  return rates.filter((r) => tierFromRate(r) === tier).map((r) => r.modelId);
}

export function invalidateRatesCache(): void {
  invalidateSource();
}
