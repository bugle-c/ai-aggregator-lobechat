export interface RecommendedModel {
  description: string;
  modelId: string;
  order: number;
}

export const RECOMMENDED_MODELS: RecommendedModel[] = [
  {
    description: 'Умный и быстрый — для большинства задач',
    modelId: 'claude-sonnet-4-6',
    order: 1,
  },
  {
    description: 'Флагман для сложных задач',
    modelId: 'gpt-5.2',
    order: 2,
  },
  {
    description: 'Самый быстрый — простые вопросы',
    modelId: 'gpt-5-mini',
    order: 3,
  },
  {
    description: 'Глубокий анализ — математика, код',
    modelId: 'deepseek-reasoner',
    order: 4,
  },
];
