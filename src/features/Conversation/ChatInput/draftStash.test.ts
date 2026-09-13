import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearDraft,
  draftStashKey,
  isCreditsExhaustedError,
  readDraft,
  stashDraft,
} from './draftStash';

describe('draftStash', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keys drafts by agent and topic, with a stable key for a fresh chat', () => {
    expect(draftStashKey('a1', 't1')).toBe('wgpt:draft:a1:t1');
    expect(draftStashKey('a1', null)).toBe('wgpt:draft:a1:new');
    expect(draftStashKey('a1')).toBe('wgpt:draft:a1:new');
    expect(draftStashKey('a1', 't1')).not.toBe(draftStashKey('a1', 't2'));
  });

  it('round-trips a draft and clears it', () => {
    const key = draftStashKey('a1', 't1');
    stashDraft(key, 'hello  ');
    expect(readDraft(key)).toBe('hello  ');
    clearDraft(key);
    expect(readDraft(key)).toBeNull();
  });

  it('does not keep whitespace-only drafts (and drops a previous one)', () => {
    const key = draftStashKey('a1', 't1');
    stashDraft(key, 'real text');
    stashDraft(key, '   ');
    expect(readDraft(key)).toBeNull();
  });

  it('survives a storage that throws (private mode / quota)', () => {
    const key = draftStashKey('a1', 't1');
    // Safari private mode / blocked storage: the accessor itself throws.
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => stashDraft(key, 'x')).not.toThrow();
    expect(readDraft(key)).toBeNull();
    expect(() => clearDraft(key)).not.toThrow();
  });

  it('recognises the credits-exhausted server message only', () => {
    expect(
      isCreditsExhaustedError('Кредиты закончились. Пополните баланс или обновите план.'),
    ).toBe(true);
    expect(isCreditsExhaustedError('Дневной лимит достигнут')).toBe(false);
    expect(isCreditsExhaustedError(undefined)).toBe(false);
    expect(isCreditsExhaustedError(null)).toBe(false);
  });
});
