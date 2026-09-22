import { describe, expect, it } from 'vitest';

import { isSyncablePricingUnit } from '../wavespeed-sync-guard';

describe('wavespeed-sync-guard', () => {
  it('syncs per-image rows (WaveSpeed unit_price is a per-run average)', () => {
    expect(isSyncablePricingUnit('image')).toBe(true);
  });

  it('never overwrites per-second or per-token rows with a per-run average', () => {
    expect(isSyncablePricingUnit('second')).toBe(false);
    expect(isSyncablePricingUnit('tokens')).toBe(false);
  });
});
