import { describe, expect, it } from 'vitest';

import { recurringDisclosure } from '../recurringDisclosure';

describe('recurringDisclosure', () => {
  it('states the auto-renewal, the real plan price and the way out', () => {
    expect(recurringDisclosure(490)).toBe(
      'Продлевается автоматически по 490 ₽/мес, отменить можно в любой момент',
    );
  });

  it('uses whatever price it is given', () => {
    expect(recurringDisclosure(1290)).toContain('по 1290 ₽/мес');
  });
});
