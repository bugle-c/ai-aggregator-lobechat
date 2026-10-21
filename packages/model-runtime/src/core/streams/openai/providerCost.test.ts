import type { ModelUsage } from '@lobechat/types';
import { expect, it } from 'vitest';

import { OpenAIStream } from './openai';

it('delivers actual USD and generation identity through a completed SSE stream', async () => {
  let completed: { usage?: ModelUsage } | undefined;
  const upstream = new ReadableStream({
    start(controller) {
      controller.enqueue({ id: 'gen-audit-fixture', choices: [{ index: 0, delta: { content: 'OK' } }] });
      controller.enqueue({ id: 'gen-audit-fixture', choices: [], usage: {
        prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200,
        cost: 0.0151, prompt_tokens_details: { cached_tokens: 800, cache_write_tokens: 100 },
      } });
      controller.close();
    },
  });
  const stream = OpenAIStream(upstream, { callbacks: { onCompletion: async (result) => { completed = result; } } });
  const reader = stream.getReader();
  while (!(await reader.read()).done) { /* Drain the actual transformation pipeline. */ }
  expect(completed?.usage).toMatchObject({ providerCostUsd: 0.0151,
    providerRequestId: 'gen-audit-fixture', inputCacheMissTokens: 100,
    inputCachedTokens: 800, inputWriteCacheTokens: 100, totalOutputTokens: 200 });
});
