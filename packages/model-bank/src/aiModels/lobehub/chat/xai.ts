import type { AIChatModelCard } from '../../../types/aiModel';

export const xaiChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 500_000,
    description:
      'Grok 4.5 — xAI flagship: sharper reasoning and cheaper inference than Grok 4.20. Note: context reduced to 500K.',
    displayName: 'Grok 4.5',
    enabled: true,
    id: 'grok-4.5',
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-07-30',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 2_000_000,
    description:
      'Grok 4.20 — xAI flagship with a 2M-token context window. Excels at NLP, math and reasoning; ideal for very long-document analysis.',
    displayName: 'Grok 4.20',
    enabled: true,
    id: 'grok-4-20',
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-20',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
];
