import { type AIChatModelCard } from '../../../types/aiModel';

// Local models served by Ollama on the same Hetzner host (/opt/ollama,
// http://ollama:11434/v1 inside the lobe-network bridge). Exposed under
// the `lobehub` provider umbrella so they sit alongside the cloud models
// in the picker instead of cluttering the sidebar with a second provider.
//
// Routing for these IDs is handled by
// `packages/business/model-runtime/src/router-runtime-options.ts` — when the
// requested `model` is one of the IDs below the router returns an
// OpenAI-compatible runtime pointed at the Ollama endpoint instead of
// OpenRouter.
//
// Pricing here (zero rates) is for UI display only — actual billing reads
// from Supabase `ai_aggregator.model_rates` rows, which are also zero with
// tier_override gating the heavyweight pair to basic+ plans.
//
// `· local` suffix in displayName is the UI hint that this runs on our own
// CPU and has no per-token cost. Until we add a proper tag pill this is the
// cheapest place to surface the fact.
export const localChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Gemma 4 E4B на нашем сервере. Бесплатна для всех тарифов. Подходит для коротких ответов и простых задач.',
    displayName: 'Gemma 4 E4B · local · бесплатно',
    enabled: true,
    id: 'gemma4:e4b',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-05-11',
    type: 'chat',
  },
  {
    abilities: {},
    contextWindowTokens: 32_768,
    description:
      'Gemma 4 26B без цензуры (EGA abliteration MoE) на нашем сервере. Используйте для SEO/контент-задач, где cloud-модели отказываются.',
    displayName: 'Gemma 4 26B Uncensored · local',
    // Hidden from the picker as of 2026-05-11 — user can still call it by id
    // (it stays in router-runtime LOCAL_OLLAMA_MODELS), but it's not surfaced
    // in the UI list. Flip to `enabled: true` to reveal again.
    enabled: false,
    id: 'hf.co/TrevorJS/gemma-4-26B-A4B-it-uncensored-GGUF:Q4_K_M',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-05-11',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Qwen3-Coder 30B (MoE 3B active) на нашем сервере. Coding-модель уровня Sonnet 3.5 на SWE-bench, контекст 32K.',
    displayName: 'Qwen3-Coder 30B · local',
    enabled: true,
    id: 'qwen3-coder:30b-32k',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-05-11',
    type: 'chat',
  },
];
