import type { AIChatModelCard } from '../../../types/aiModel';

export const deepseekChatModels: AIChatModelCard[] = [
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_048_576,
    description:
      "DeepSeek V4.1 Flash — first model on DeepSeek's Causal Encoder-Decoder architecture; markedly smarter than V4 Flash at everyday chat, coding and vision. 1M-token context. Platform default.",
    displayName: 'DeepSeek V4.1 Flash',
    enabled: true,
    id: 'deepseek-v4.1-flash',
    maxOutput: 384_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-09-10',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'DeepSeek V4 Pro — flagship reasoning model with a 1M-token context. Strong on coding, math and agent tasks at a fraction of the cost of frontier closed models.',
    displayName: 'DeepSeek V4 Pro',
    enabled: true,
    id: 'deepseek-v4-pro',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.43, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.87, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-20',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'DeepSeek V4 Flash — cheapest member of the V4 family; superseded by V4.1 Flash as the default but still the lowest-cost option. 1M-token context.',
    displayName: 'DeepSeek V4 Flash',
    enabled: true,
    id: 'deepseek-v4-flash',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.07, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.13, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-20',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 65_536,
    description:
      'DeepSeek V3.2 balances reasoning and output length for daily QA and agent tasks. Public benchmarks reach GPT-5 levels, and it is the first to integrate thinking into tool use, leading open-source agent evaluations.',
    displayName: 'DeepSeek V3.2',
    enabled: true,
    id: 'deepseek-chat',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.56, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.07, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.68, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-01',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 65_536,
    description:
      'DeepSeek V3.2 Thinking is a deep reasoning model that generates chain-of-thought before outputs for higher accuracy, with top competition results and reasoning comparable to Gemini-3.0-Pro.',
    displayName: 'DeepSeek V3.2 Thinking',
    enabled: true,
    id: 'deepseek-reasoner',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.55, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.19, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-01',
    type: 'chat',
  },
];
