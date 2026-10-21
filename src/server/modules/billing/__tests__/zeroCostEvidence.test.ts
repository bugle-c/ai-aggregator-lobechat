import { expect, it } from 'vitest';

import { decideChargeAfterStream } from '../decideChargeAfterStream';
import { normalizeBillingUsage } from '../normalizeUsage';

it('keeps an explicitly free empty completion distinguishable from missing usage', () => {
  const usage = normalizeBillingUsage({ providerCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0 });
  expect(decideChargeAfterStream(usage, 0, [])).toMatchObject({ skip: false, source: 'provider', inputTokens: 0, outputTokens: 0 });
  expect(decideChargeAfterStream({}, 0, [])).toEqual({ skip: true, reason: 'empty-stream' });
});
