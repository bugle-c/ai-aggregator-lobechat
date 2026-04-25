export interface RecommendedModel {
  creditCost: number;
  description: string;
  modelId: string;
  order: number;
}

// Plan-tiered recommended lists. Free users see only models they can actually
// use (cheap, no premium-locked Sonnet/Opus). Paid tiers progressively unlock
// stronger flagships as primaries.
const RECOMMENDED_BY_PLAN: Record<string, RecommendedModel[]> = {
  free: [
    {
      creditCost: 1,
      description: 'Самый быстрый — простые вопросы',
      modelId: 'gpt-5-mini',
      order: 1,
    },
    {
      creditCost: 1,
      description: 'Умный и дешёвый',
      modelId: 'deepseek-chat',
      order: 2,
    },
    {
      creditCost: 1,
      description: 'Минимум кредитов',
      modelId: 'gpt-5-nano',
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
      description: 'Самый быстрый',
      modelId: 'gpt-5-mini',
      order: 1,
    },
    {
      creditCost: 3,
      description: 'Универсал',
      modelId: 'gpt-4.1-mini',
      order: 2,
    },
    {
      creditCost: 5,
      description: 'Смышлёный, быстрый',
      modelId: 'claude-haiku-4-5-20251001',
      order: 3,
    },
    {
      creditCost: 1,
      description: 'Длинные тексты',
      modelId: 'gemini-2.5-flash',
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
      description: 'Хорош для анализа',
      modelId: 'gemini-2.5-pro',
      order: 3,
    },
    {
      creditCost: 8,
      description: 'Глубокий анализ — математика, код',
      modelId: 'deepseek-reasoner',
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
      creditCost: 8,
      description: 'Глубокий анализ',
      modelId: 'deepseek-reasoner',
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
