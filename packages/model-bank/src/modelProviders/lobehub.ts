import type { ModelProviderCard } from '@/types/llm';

const LobeHub: ModelProviderCard = {
  chatModels: [],
  description:
    'WebGPT Cloud uses official APIs to access AI models and measures usage with Credits tied to model tokens.',
  enabled: true,
  id: 'lobehub',
  modelsUrl: 'https://gptweb.ru',
  name: 'WebGPT',
  settings: {
    modelEditable: false,
    showAddNewModel: false,
    showModelFetcher: false,
  },
  showConfig: false,
  url: 'https://gptweb.ru',
};

export default LobeHub;

export const planCardModels = [
  'claude-sonnet-4-6',
  'gemini-3.1-pro-preview',
  'gpt-5.4',
  'deepseek-v4-flash',
];
