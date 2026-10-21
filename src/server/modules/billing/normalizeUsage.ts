import { z } from 'zod';

const token = z.number().finite().nonnegative().optional();
const usageSchema = z.object({
  totalInputTokens: token, inputCacheMissTokens: token, inputTextTokens: token,
  totalOutputTokens: token, outputTextTokens: token, inputCachedTokens: token,
  inputWriteCacheTokens: token, providerCostUsd: token, cost: token,
  prompt_tokens: token, completion_tokens: token, input_tokens: token, output_tokens: token,
  inputTokens: token, outputTokens: token, cache_read_input_tokens: token,
  cache_creation_input_tokens: token, cached_content_token_count: token,
  cacheReadTokens: token, cacheWrite5mTokens: token, cacheWrite1hTokens: token,
  prompt_tokens_details: z.object({ cached_tokens: token, cache_write_tokens: token }).optional(),
  cache_creation: z.object({ ephemeral_5m_input_tokens: token, ephemeral_1h_input_tokens: token }).optional(),
});

/** Normalize inclusive OpenAI totals and exclusive Anthropic/canonical categories once. */
export function normalizeBillingUsage(raw: unknown) {
  const usage = usageSchema.parse(raw);
  const cacheRead = usage.inputCachedTokens ?? usage.cache_read_input_tokens ??
    usage.prompt_tokens_details?.cached_tokens ?? usage.cached_content_token_count ?? usage.cacheReadTokens ?? 0;
  const cacheWrite1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? usage.cacheWrite1hTokens ?? 0;
  const writes = usage.inputWriteCacheTokens ?? usage.cache_creation_input_tokens ??
    usage.prompt_tokens_details?.cache_write_tokens ?? usage.cacheWrite5mTokens ?? 0;
  const cacheWrite5m = usage.cache_creation?.ephemeral_5m_input_tokens ?? Math.max(0, writes - cacheWrite1h);
  const canonical = usage.totalInputTokens !== undefined || usage.inputCacheMissTokens !== undefined;
  const input = canonical
    ? usage.inputCacheMissTokens ?? Math.max(0, (usage.totalInputTokens ?? usage.inputTextTokens ?? 0) - cacheRead - cacheWrite5m - cacheWrite1h)
    : usage.prompt_tokens !== undefined
      ? Math.max(0, usage.prompt_tokens - cacheRead - cacheWrite5m - cacheWrite1h)
      : usage.input_tokens ?? usage.inputTokens ?? usage.inputTextTokens ?? 0;
  const output = usage.totalOutputTokens ?? usage.completion_tokens ?? usage.output_tokens ??
    usage.outputTokens ?? usage.outputTextTokens ?? 0;
  // Normalized UI cost can be estimated; only raw OpenAI cost is authoritative here.
  const cost = usage.providerCostUsd ?? (!canonical && usage.prompt_tokens !== undefined ? usage.cost : undefined);
  return { input, output, cacheRead, cacheWrite5m, cacheWrite1h, cost };
}
