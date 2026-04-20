export interface RecommendedModel {
  creditCost: number;
  description: string;
  modelId: string;
  order: number;
}

export const RECOMMENDED_MODELS: RecommendedModel[] = [
  {
    creditCost: 13,
    description: 'Умный и быстрый — для большинства задач',
    modelId: 'claude-sonnet-4-6',
    order: 1,
  },
  {
    creditCost: 10,
    description: 'Флагман для сложных задач',
    modelId: 'gpt-5.2',
    order: 2,
  },
  {
    creditCost: 1,
    description: 'Самый быстрый — простые вопросы',
    modelId: 'gpt-5-mini',
    order: 3,
  },
  {
    creditCost: 8,
    description: 'Глубокий анализ — математика, код',
    modelId: 'deepseek-reasoner',
    order: 4,
  },
];
