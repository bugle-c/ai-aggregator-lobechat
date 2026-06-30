import type { AIChatModelCard } from '../../../types/aiModel';

export const zhipuChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'Zhipu GLM-5.2 — flagship Chinese reasoning model with configurable reasoning effort. 1M-token context, strong on math and coding.',
    displayName: 'GLM-5.2',
    enabled: true,
    id: 'glm-5.2',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.94, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-06-17',
    type: 'chat',
  },
];
