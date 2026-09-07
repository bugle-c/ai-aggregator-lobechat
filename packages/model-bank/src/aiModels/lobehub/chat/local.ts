import { type AIChatModelCard } from '../../../types/aiModel';

// Local Ollama models retired 2026-09-07 (gemma4:e4b "WebGPT Mini",
// Qwen3-Coder 30B, Gemma 4 26B). CPU inference was too slow to recommend;
// DeepSeek V4 Flash (via OpenRouter, with markupOverride=2.0 in
// ai_aggregator.model_rates) replaces WebGPT Mini as the cheap default.
// Empty export kept so consumers that spread it still compile.
export const localChatModels: AIChatModelCard[] = [];
