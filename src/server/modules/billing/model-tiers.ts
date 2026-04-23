import {
  fetchAllRates,
  fetchRate,
  invalidateRatesCache as invalidateSource,
  type RateView,
} from '@/server/services/billing/rates-source';

export type ModelTier = 'cheap' | 'mid' | 'high' | 'premium';
export type PlanSlug = 'free' | 'basic' | 'pro' | 'pro_max';

/**
 * Tier is classified from the **marked-up** price (what WE charge, not what
 * provider charges). Keeps plan-access consistent even if markup changes.
 * Unit-aware thresholds; see design doc §Tier classification.
 */
function tierFromRate(rate: RateView): ModelTier {
  if (rate.tierOverride) return rate.tierOverride;
  const markedUp = rate.markup;
  if (rate.pricingUnit === 'tokens') {
    const out = (rate.outputPer1M ?? 0) * markedUp;
    if (out <= 3) return 'cheap';
    if (out <= 15) return 'mid';
    if (out <= 45) return 'high';
    return 'premium';
  }
  if (rate.pricingUnit === 'image') {
    const u = (rate.perUnit ?? 0) * markedUp;
    if (u <= 0.03) return 'cheap';
    if (u <= 0.15) return 'mid';
    if (u <= 0.6) return 'high';
    return 'premium';
  }
  // second (video)
  const u = (rate.perUnit ?? 0) * markedUp;
  if (u <= 0.06) return 'cheap';
  if (u <= 0.3) return 'mid';
  if (u <= 1.2) return 'high';
  return 'premium';
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
