export interface RecommendedModel {
  description: string;
  modelId: string;
  order: number;
}

export const RECOMMENDED_MODELS: RecommendedModel[] = [
  {
    description: 'Умный и быстрый — для большинства задач',
    modelId: 'gpt-4o',
    order: 1,
  },
  {
    description: 'Лучший для текстов и анализа',
    modelId: 'claude-sonnet-4-20250514',
    order: 2,
  },
  {
    description: 'Самый быстрый — простые вопросы',
    modelId: 'gpt-4o-mini',
    order: 3,
  },
  {
    description: 'Глубокий анализ — математика, код',
    modelId: 'o1',
    order: 4,
  },
];
