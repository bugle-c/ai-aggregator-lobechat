// Per-model credit pricing based on actual API costs
// Credits are calculated from USD token prices → RUB cost → credits

export interface ModelRate {
  inputPer1M: number; // USD per 1M input tokens
  outputPer1M: number; // USD per 1M output tokens
}

// Safe default: Claude Sonnet pricing (mid-high tier)
export const DEFAULT_MODEL_RATE: ModelRate = { inputPer1M: 3.0, outputPer1M: 15.0 };

// 1 credit = 0.15 RUB of API cost
export const CREDIT_VALUE_RUB = 0.15;

// Exchange rate for USD → RUB conversion
export const USD_TO_RUB = 100;

// Model pricing map (USD per 1M tokens)
// Each model has both short ID and OpenRouter-prefixed ID
const rates: Record<string, ModelRate> = {
  // === Cheap ===
  'deepseek-chat': { inputPer1M: 0.32, outputPer1M: 0.89 },
  'gpt-5-mini': { inputPer1M: 0.25, outputPer1M: 2.0 },
  'gpt-5-nano': { inputPer1M: 0.1, outputPer1M: 0.4 },
  'gemini-2.5-flash': { inputPer1M: 0.15, outputPer1M: 0.6 },

  // === Mid ===
  'gemini-3-flash-preview': { inputPer1M: 0.5, outputPer1M: 3.0 },
  'claude-haiku-4-5-20251001': { inputPer1M: 1.0, outputPer1M: 5.0 },
  'gpt-4.1-mini': { inputPer1M: 0.4, outputPer1M: 1.6 },

  // === Mid-high ===
  'gpt-5.1': { inputPer1M: 1.25, outputPer1M: 10.0 },
  'gemini-2.5-pro': { inputPer1M: 1.25, outputPer1M: 10.0 },
  'gemini-3-pro-preview': { inputPer1M: 1.25, outputPer1M: 10.0 },
  'gemini-3.1-pro-preview': { inputPer1M: 1.25, outputPer1M: 10.0 },
  'deepseek-reasoner': { inputPer1M: 0.7, outputPer1M: 2.5 },
  'gpt-4.1': { inputPer1M: 2.0, outputPer1M: 8.0 },
  'o4-mini': { inputPer1M: 1.1, outputPer1M: 4.4 },

  // === Expensive ===
  'gpt-5.2': { inputPer1M: 1.75, outputPer1M: 14.0 },
  'gpt-5-chat-latest': { inputPer1M: 1.75, outputPer1M: 14.0 },
  'claude-sonnet-4-6': { inputPer1M: 3.0, outputPer1M: 15.0 },
  'claude-sonnet-4-5-20250929': { inputPer1M: 3.0, outputPer1M: 15.0 },
  'grok-4': { inputPer1M: 3.0, outputPer1M: 15.0 },
  'o3': { inputPer1M: 2.0, outputPer1M: 8.0 },

  // === Premium ===
  'claude-opus-4-6': { inputPer1M: 5.0, outputPer1M: 25.0 },
  'claude-opus-4-5-20251101': { inputPer1M: 5.0, outputPer1M: 25.0 },

  // === Legacy ===
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10.0 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
  'chatgpt-4o-latest': { inputPer1M: 5.0, outputPer1M: 15.0 },
  'gpt-4-turbo': { inputPer1M: 10.0, outputPer1M: 30.0 },

  // === Other ===
  'MiniMax-M2.5': { inputPer1M: 0.5, outputPer1M: 2.0 },
  'MiniMax-M2.5-highspeed': { inputPer1M: 0.3, outputPer1M: 1.0 },
  'MiniMax-M2.1': { inputPer1M: 0.3, outputPer1M: 1.0 },
  'MiniMax-M2.1-highspeed': { inputPer1M: 0.2, outputPer1M: 0.8 },
  'kimi-k2.5': { inputPer1M: 1.0, outputPer1M: 4.0 },
};

// OpenRouter provider prefixes for each model
const openRouterPrefixes: Record<string, string> = {
  'deepseek-chat': 'deepseek',
  'deepseek-reasoner': 'deepseek',
  'gpt-5-mini': 'openai',
  'gpt-5-nano': 'openai',
  'gpt-5.1': 'openai',
  'gpt-5.2': 'openai',
  'gpt-5-chat-latest': 'openai',
  'gpt-4.1-mini': 'openai',
  'gpt-4.1': 'openai',
  'gpt-4o': 'openai',
  'gpt-4o-mini': 'openai',
  'chatgpt-4o-latest': 'openai',
  'gpt-4-turbo': 'openai',
  'o4-mini': 'openai',
  'o3': 'openai',
  'gemini-2.5-flash': 'google',
  'gemini-2.5-pro': 'google',
  'gemini-3-flash-preview': 'google',
  'gemini-3-pro-preview': 'google',
  'gemini-3.1-pro-preview': 'google',
  'claude-haiku-4-5-20251001': 'anthropic',
  'claude-sonnet-4-6': 'anthropic',
  'claude-sonnet-4-5-20250929': 'anthropic',
  'claude-opus-4-6': 'anthropic',
  'claude-opus-4-5-20251101': 'anthropic',
  'grok-4': 'x-ai',
  'MiniMax-M2.5': 'minimax',
  'MiniMax-M2.5-highspeed': 'minimax',
  'MiniMax-M2.1': 'minimax',
  'MiniMax-M2.1-highspeed': 'minimax',
  'kimi-k2.5': 'moonshotai',
};

// Build the full MODEL_RATES map with OpenRouter-prefixed duplicates
export const MODEL_RATES: Record<string, ModelRate> = { ...rates };
for (const [modelId, prefix] of Object.entries(openRouterPrefixes)) {
  const rate = rates[modelId];
  if (rate) {
    MODEL_RATES[`${prefix}/${modelId}`] = rate;
  }
}

/**
 * Get the rate for a model, falling back to DEFAULT_MODEL_RATE for unknown models
 */
export function getModelRate(modelId: string): ModelRate {
  return MODEL_RATES[modelId] || DEFAULT_MODEL_RATE;
}

export interface TokenBreakdown {
  inputTokens: number; // base non-cached input
  outputTokens: number;
  cacheWrite5mTokens?: number; // Anthropic 5m TTL write = 1.25× inputRate
  cacheWrite1hTokens?: number; // Anthropic 1h TTL write = 2.00× inputRate
  cacheReadTokens?: number; // All providers: cached read = 0.10× inputRate
}

/**
 * Compute USD cost for a given model and token breakdown, including
 * prompt-cache write/read multipliers. The caller should pass the breakdown
 * they saw in the provider's usage field; omitted fields default to 0.
 *
 * Anthropic 2025 pricing multipliers:
 *   cache_write_5m = 1.25 × input
 *   cache_write_1h = 2.00 × input
 *   cache_read     = 0.10 × input
 * OpenAI / Gemini only expose cached-read (~0.25-0.5× input) — we conservatively
 * bill them at 0.25× input (matches Anthropic's 90% discount approximation).
 */
export function computeCostUsd(modelId: string, b: TokenBreakdown): number {
  const rate = getModelRate(modelId);
  const inPer1M = rate.inputPer1M;
  const outPer1M = rate.outputPer1M;
  return (
    (b.inputTokens / 1_000_000) * inPer1M +
    ((b.cacheWrite5mTokens ?? 0) / 1_000_000) * inPer1M * 1.25 +
    ((b.cacheWrite1hTokens ?? 0) / 1_000_000) * inPer1M * 2.0 +
    ((b.cacheReadTokens ?? 0) / 1_000_000) * inPer1M * 0.1 +
    (b.outputTokens / 1_000_000) * outPer1M
  );
}

/**
 * Calculate credits consumed. Backwards-compatible signature: if only
 * (inputTokens, outputTokens) are passed, behaves as before. Pass the full
 * TokenBreakdown object to correctly bill cache tokens.
 */
export function calculateCredits(
  modelId: string,
  inputOrBreakdown: number | TokenBreakdown,
  outputTokens?: number,
): number {
  const breakdown: TokenBreakdown =
    typeof inputOrBreakdown === 'number'
      ? { inputTokens: inputOrBreakdown, outputTokens: outputTokens ?? 0 }
      : inputOrBreakdown;
  const costUsd = computeCostUsd(modelId, breakdown);
  const costRub = costUsd * USD_TO_RUB;
  return Math.max(1, Math.ceil(costRub / CREDIT_VALUE_RUB));
}

/**
 * Estimate credits for a typical message (2000 input + 700 output tokens)
 */
export function estimateCreditsPerMessage(modelId: string): number {
  return calculateCredits(modelId, 2000, 700);
}

// Backward compatibility: flat token-based conversion (used by checkUsageLimit)
export const TOKENS_PER_CREDIT = 2500;

export function tokensToCredits(tokens: number): number {
  return Math.max(1, Math.ceil(tokens / TOKENS_PER_CREDIT));
}
