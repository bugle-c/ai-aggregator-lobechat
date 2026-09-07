import type { ModelProviderCard } from '@/types/llm';

// Local Ollama models retired 2026-09-07 (see aiModels/lobehub/chat/local.ts
// for context). Kept as an empty disabled provider so the SDK id and the
// modelProviders/index.ts import graph don't break; nothing is exposed in
// the UI.
const Ollama: ModelProviderCard = {
  chatModels: [],
  defaultShowBrowserRequest: false,
  description: 'Локальные модели WebGPT (не используются с 2026-09-07).',
  disableBrowserRequest: true,
  enabled: false,
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
