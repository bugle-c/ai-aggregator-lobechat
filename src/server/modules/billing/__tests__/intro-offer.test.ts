import { describe, expect, it } from 'vitest';

import { INTRO_OFFER_BONUS_DAYS, nextBonusState } from '../intro-offer';

const now = new Date('2026-09-07T12:00:00Z');
const day = 86_400_000;

describe('nextBonusState (intro offer → expiring bonus pool)', () => {
  it('starts a fresh pool that lives INTRO_OFFER_BONUS_DAYS', () => {
    const next = nextBonusState(null, 500, now);
    expect(next.bonusBalance).toBe(500);
    expect(next.bonusBalanceExpiresAt.getTime()).toBe(now.getTime() + INTRO_OFFER_BONUS_DAYS * day);
  });

  it('keeps a live remainder and extends its life to the new expiry', () => {
    const next = nextBonusState(
      { bonusBalance: 15, bonusBalanceExpiresAt: new Date(now.getTime() + 2 * day) },
      500,
      now,
    );
    expect(next.bonusBalance).toBe(515);
    expect(next.bonusBalanceExpiresAt.getTime()).toBe(now.getTime() + 7 * day);
  });

  it('does not revive an expired remainder', () => {
    const next = nextBonusState(
      { bonusBalance: 15, bonusBalanceExpiresAt: new Date(now.getTime() - day) },
      500,
      now,
    );
    expect(next.bonusBalance).toBe(500);
  });

  it('treats a zero / null pool as empty', () => {
    expect(nextBonusState({ bonusBalance: 0, bonusBalanceExpiresAt: null }, 500, now).bonusBalance).toBe(500);
    expect(nextBonusState({ bonusBalance: null, bonusBalanceExpiresAt: new Date(now.getTime() + day) }, 500, now).bonusBalance).toBe(500);
  });
});
