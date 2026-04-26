import { describe, expect, it } from 'vitest';

import { generateReferralCode, isDisposableEmail, selfReferCheck } from '../antiAbuse';

describe('isDisposableEmail', () => {
  it('detects classic throwaway domains', () => {
    expect(isDisposableEmail('foo@mailinator.com')).toBe(true);
    expect(isDisposableEmail('foo@tempmail.io')).toBe(true);
    expect(isDisposableEmail('foo@10minutemail.com')).toBe(true);
    expect(isDisposableEmail('foo@guerrillamail.com')).toBe(true);
    expect(isDisposableEmail('foo@yopmail.fr')).toBe(true);
    expect(isDisposableEmail('FOO@MAILINATOR.COM')).toBe(true);
    expect(isDisposableEmail('  foo@mailinator.com  ')).toBe(true);
  });

  it('passes legitimate domains', () => {
    expect(isDisposableEmail('user@gmail.com')).toBe(false);
    expect(isDisposableEmail('user@yandex.ru')).toBe(false);
    expect(isDisposableEmail('user@gptweb.ru')).toBe(false);
    expect(isDisposableEmail('user@protonmail.com')).toBe(false);
  });

  it('returns false for empty / malformed input', () => {
    expect(isDisposableEmail('')).toBe(false);
    expect(isDisposableEmail(null)).toBe(false);
    expect(isDisposableEmail(undefined)).toBe(false);
    expect(isDisposableEmail('not-an-email')).toBe(false);
  });

  it('does NOT flag look-alikes that contain disposable substring without @', () => {
    // "mailinator" appearing as part of a real domain after @ should still match,
    // but not when it's the local part.
    expect(isDisposableEmail('mailinator.user@gmail.com')).toBe(false);
  });
});

describe('selfReferCheck', () => {
  it('blocks same user_id', () => {
    const result = selfReferCheck({
      referrerUserId: 'user_abc',
      newUserId: 'user_abc',
      referrerEmail: 'a@x.com',
      newUserEmail: 'b@x.com',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('same_user_id');
  });

  it('blocks same email (case-insensitive)', () => {
    const result = selfReferCheck({
      referrerUserId: 'user_a',
      newUserId: 'user_b',
      referrerEmail: 'Foo@Example.COM',
      newUserEmail: '  foo@example.com  ',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('same_email');
  });

  it('passes legitimate referrals', () => {
    const result = selfReferCheck({
      referrerUserId: 'user_a',
      newUserId: 'user_b',
      referrerEmail: 'alice@example.com',
      newUserEmail: 'bob@example.com',
    });
    expect(result.ok).toBe(true);
  });

  it('passes when one or both emails are missing', () => {
    expect(selfReferCheck({ referrerUserId: 'a', newUserId: 'b' }).ok).toBe(true);
    expect(
      selfReferCheck({
        referrerUserId: 'a',
        newUserId: 'b',
        referrerEmail: 'x@y.com',
      }).ok,
    ).toBe(true);
  });
});

describe('generateReferralCode', () => {
  it('produces 8-char lowercase alphanumeric', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateReferralCode();
      expect(code).toHaveLength(8);
      expect(code).toMatch(/^[a-z0-9]{8}$/);
    }
  });

  it('produces sufficiently varied output', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 1000; i++) codes.add(generateReferralCode());
    // 36^8 ≈ 2.8e12 — collisions in 1000 draws should be effectively impossible.
    expect(codes.size).toBe(1000);
  });
});
