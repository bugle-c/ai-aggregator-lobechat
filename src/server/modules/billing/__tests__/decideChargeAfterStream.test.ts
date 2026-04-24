import { describe, expect, it } from 'vitest';

import { decideChargeAfterStream } from '../decideChargeAfterStream';

describe('decideChargeAfterStream', () => {
  it('uses provider-reported usage verbatim when present', () => {
    const decision = decideChargeAfterStream(
      { input: 1234, output: 567, cacheRead: 10, cacheWrite5m: 20, cacheWrite1h: 0 },
      0, // observed chars ignored when provider reports usage
      [{ content: 'hi' }],
    );
    expect(decision.skip).toBe(false);
    if (!decision.skip) {
      expect(decision.source).toBe('provider');
      expect(decision.inputTokens).toBe(1234);
      expect(decision.outputTokens).toBe(567);
      expect(decision.cacheReadTokens).toBe(10);
      expect(decision.cacheWrite5mTokens).toBe(20);
    }
  });

  it('estimates from observed output when provider omits usage but stream had content', () => {
    const decision = decideChargeAfterStream(
      {},
      4000, // 4000 chars → ~1000 tokens output
      [{ content: 'a'.repeat(400) }],
    );
    expect(decision.skip).toBe(false);
    if (!decision.skip) {
      expect(decision.source).toBe('estimated');
      expect(decision.outputTokens).toBe(1000);
      expect(decision.inputTokens).toBeGreaterThanOrEqual(100);
    }
  });

  it('SKIPS charge when stream was empty and provider omitted usage (Bug #2)', () => {
    const decision = decideChargeAfterStream({}, 0, [{ content: 'hello' }]);
    expect(decision.skip).toBe(true);
    if (decision.skip) {
      expect(decision.reason).toBe('empty-stream');
    }
  });

  it('SKIPS when usage object is present but zeroed (input=0, output=0) and no chars observed', () => {
    // input=0 and output=0 are falsy so we fall into the empty-stream branch,
    // not the provider branch. This is intentional — a zero/zero usage with no
    // content is equivalent to an empty response.
    const decision = decideChargeAfterStream({ input: 0, output: 0, cacheRead: 0 }, 0, [
      { content: 'hello' },
    ]);
    expect(decision.skip).toBe(true);
  });

  it('does NOT skip when provider reports output tokens only (e.g. Anthropic sometimes)', () => {
    const decision = decideChargeAfterStream({ output: 100 }, 0, []);
    expect(decision.skip).toBe(false);
    if (!decision.skip) {
      expect(decision.source).toBe('provider');
      expect(decision.outputTokens).toBe(100);
    }
  });
});
