export interface RecommendedModel {
  creditCost: number;
  description: string;
  modelId: string;
  order: number;
}

// Plan-tiered recommended lists. gpt-5-mini (cloud, via the `lobehub`
// gateway) is the #1 default — it's the cheapest fast cloud model and
// matches DEFAULT_MODEL in @lobechat/const/settings/llm.ts. The local
// Gemma 4 E4B stays available as the free fallback but is demoted: on
// our CPU-only box it takes 5–10 min/answer, so it's no longer the
// default. Paid tiers get premium cloud models for bigger brains.
const RECOMMENDED_BY_PLAN: Record<string, RecommendedModel[]> = {
  free: [
    {
      creditCost: 1,
      description: 'Самый быстрый — подходит для большинства задач',
      modelId: 'gpt-5-mini',
      order: 1,
    },
    {
      creditCost: 0,
      description: 'Локальная — бесплатная, но медленнее',
      modelId: 'gemma4:e4b',
      order: 2,
    },
    {
      creditCost: 1,
      description: 'Умный и дешёвый',
      modelId: 'deepseek-chat',
      order: 3,
    },
    {
      creditCost: 1,
      description: 'Хорош для длинных текстов',
      modelId: 'gemini-2.5-flash',
      order: 4,
    },
  ],
  basic: [
    {
      creditCost: 1,
      description: 'Самый быстрый — для большинства задач',
      modelId: 'gpt-5-mini',
      order: 1,
    },
    {
      creditCost: 0,
      description: 'Локальная — бесплатная, но медленнее',
      modelId: 'gemma4:e4b',
      order: 2,
    },
    {
      creditCost: 3,
      description: 'Универсал',
      modelId: 'gpt-4.1-mini',
      order: 3,
    },
    {
      creditCost: 5,
      description: 'Смышлёный, быстрый',
      modelId: 'claude-haiku-4-5-20251001',
      order: 4,
    },
  ],
  pro: [
    {
      creditCost: 13,
      description: 'Умный и быстрый — для большинства задач',
      modelId: 'claude-sonnet-4-6',
      order: 1,
    },
    {
      creditCost: 8,
      description: 'Универсал GPT-5',
      modelId: 'gpt-5.1',
      order: 2,
    },
    {
      creditCost: 8,
      description: 'Глубокий анализ — математика, код',
      modelId: 'deepseek-reasoner',
      order: 3,
    },
    {
      creditCost: 0,
      description: 'Локальная — бесплатная, но медленнее',
      modelId: 'gemma4:e4b',
      order: 4,
    },
  ],
  pro_max: [
    {
      creditCost: 25,
      description: 'Премиум — самые сложные задачи',
      modelId: 'claude-opus-4-6',
      order: 1,
    },
    {
      creditCost: 14,
      description: 'Флагман для сложных задач',
      modelId: 'gpt-5.2',
      order: 2,
    },
    {
      creditCost: 13,
      description: 'Универсал',
      modelId: 'claude-sonnet-4-6',
      order: 3,
    },
    {
      creditCost: 0,
      description: 'Локальная — бесплатная, но медленнее',
      modelId: 'gemma4:e4b',
      order: 4,
    },
  ],
};

export const getRecommendedModels = (planSlug?: string | null): RecommendedModel[] => {
  if (!planSlug) return RECOMMENDED_BY_PLAN.free;
  return RECOMMENDED_BY_PLAN[planSlug] || RECOMMENDED_BY_PLAN.free;
};

// Backwards-compat default (pro tier). Prefer getRecommendedModels(planSlug).
export const RECOMMENDED_MODELS: RecommendedModel[] = RECOMMENDED_BY_PLAN.pro;
