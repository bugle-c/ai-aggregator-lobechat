import type { AIChatModelCard } from '../../../types/aiModel';

export const qwenChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Qwen 3.6 Max Preview — Alibaba flagship model, strong on reasoning, coding and multilingual tasks. 262K context.',
    displayName: 'Qwen 3.6 Max Preview',
    enabled: true,
    id: 'qwen3.6-max-preview',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.04, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6.24, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-15',
    type: 'chat',
  },
];
