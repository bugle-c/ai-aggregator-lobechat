import type { ModelProviderCard } from '@/types/llm';

// Rebranded 2026-05-11: this provider runs on our own Hetzner server (CPU
// inference, see /opt/ollama). Keep `id: 'ollama'` for SDK + MODEL_LIST
// parsing; only the user-facing name/description/URLs change.
const Ollama: ModelProviderCard = {
  chatModels: [],
  checkModel: 'gemma4:e4b',
  defaultShowBrowserRequest: false,
  description:
    'Локальные модели WebGPT на нашем сервере. Без задержек cloud-провайдеров, без лимитов сторонних API. Gemma 4 E4B бесплатна для всех тарифов.',
  id: 'ollama',
  modelList: { showModelFetcher: false },
  modelsUrl: 'https://gptweb.ru',
  name: 'WebGPT Local',
  settings: {
    defaultShowBrowserRequest: false,
    sdkType: 'ollama',
    showApiKey: false,
    showModelFetcher: false,
  },
  showApiKey: false,
  url: 'https://gptweb.ru',
};

export default Ollama;
