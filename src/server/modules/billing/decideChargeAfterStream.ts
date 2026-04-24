export interface StreamUsageData {
  cacheRead?: number;
  cacheWrite1h?: number;
  cacheWrite5m?: number;
  input?: number;
  output?: number;
}

export type ChargeDecision =
  | { reason: string; skip: true }
  | {
      cacheReadTokens: number;
      cacheWrite1hTokens: number;
      cacheWrite5mTokens: number;
      inputTokens: number;
      outputTokens: number;
      skip: false;
      source: 'provider' | 'estimated';
    };

/**
 * Decide whether (and how much) to charge after a chat stream completes.
 *
 * Three paths:
 *  1. Provider reported usage → charge exactly.
 *  2. No reported usage but stream had content → estimate from content length.
 *  3. No reported usage AND empty stream → skip charge (upstream error / abort).
 *     Previously we charged min(100 input, 500 output) = 1+ phantom credit
 *     even when no response was delivered; that produced the "+1 everywhere"
 *     overcount observed across 12 users.
 */
export function decideChargeAfterStream(
  usageData: StreamUsageData,
  observedOutputChars: number,
  messages: unknown,
): ChargeDecision {
  if (usageData.input || usageData.output) {
    return {
      skip: false,
      source: 'provider',
      inputTokens: usageData.input || 0,
      outputTokens: usageData.output || 0,
      cacheWrite5mTokens: usageData.cacheWrite5m || 0,
      cacheWrite1hTokens: usageData.cacheWrite1h || 0,
      cacheReadTokens: usageData.cacheRead || 0,
    };
  }

  // No usage reported. If we also never observed any output, the stream was
  // empty (upstream error, abort, or fast failure after headers). Don't
  // phantom-charge for a non-delivered response.
  if (observedOutputChars === 0) {
    return { skip: true, reason: 'empty-stream' };
  }

  // Stream had content but provider didn't emit a usage summary (rare but
  // legitimate for some non-OpenAI-compat providers). Estimate.
  const estimatedInput = Math.max(100, Math.round(JSON.stringify(messages || []).length / 4));
  const estimatedOutput = Math.ceil(observedOutputChars / 4);

  return {
    skip: false,
    source: 'estimated',
    inputTokens: estimatedInput,
    outputTokens: estimatedOutput,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    cacheReadTokens: 0,
  };
}
