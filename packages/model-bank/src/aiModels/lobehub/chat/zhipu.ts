import type { AIChatModelCard } from '../../../types/aiModel';

export const zhipuChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_310_720,
    description:
      'Zhipu GLM-5.3 — successor to 5.2 with cheaper input and larger 1.31M-token context. Strong on math and coding.',
    displayName: 'GLM-5.3',
    enabled: true,
    id: 'glm-5.3',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-08-10',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 1_310_720,
    description:
      'Zhipu GLM-5.3-Flash — ultra-cheap Chinese model for high-volume assistant workloads. 1.31M-token context.',
    displayName: 'GLM-5.3 Flash',
    enabled: true,
    id: 'glm-5.3-flash',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.07, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-08-10',
    type: 'chat',
  },
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
