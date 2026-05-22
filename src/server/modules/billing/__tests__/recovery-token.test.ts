import { describe, expect, it } from 'vitest';

import { signRecoveryToken, verifyRecoveryToken } from '../recovery-token';

const SECRET = 'a'.repeat(32);

describe('recovery-token', () => {
  it('sign + verify roundtrip succeeds with same secret and unexpired token', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const t = signRecoveryToken({ paymentId: 'p1', userId: 'u1', method: 'sbp', exp }, SECRET);
    const v = verifyRecoveryToken(t, SECRET);
    expect(v).toEqual({ paymentId: 'p1', userId: 'u1', method: 'sbp', exp });
  });

  it('verify rejects token signed with different secret', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const t = signRecoveryToken({ paymentId: 'p1', userId: 'u1', method: 'sbp', exp }, SECRET);
    expect(verifyRecoveryToken(t, 'b'.repeat(32))).toBeNull();
  });

  it('verify rejects expired token', () => {
    const exp = Math.floor(Date.now() / 1000) - 10; // expired 10s ago
    const t = signRecoveryToken({ paymentId: 'p1', userId: 'u1', method: 'sbp', exp }, SECRET);
    expect(verifyRecoveryToken(t, SECRET)).toBeNull();
  });

  it('verify rejects token whose exp equals current second (boundary)', () => {
    const exp = Math.floor(Date.now() / 1000); // exactly now
    const t = signRecoveryToken({ paymentId: 'p1', userId: 'u1', method: 'sbp', exp }, SECRET);
    expect(verifyRecoveryToken(t, SECRET)).toBeNull();
  });

  it('verify rejects malformed token', () => {
    expect(verifyRecoveryToken('not-a-token', SECRET)).toBeNull();
    expect(verifyRecoveryToken('a.b', SECRET)).toBeNull();
    expect(verifyRecoveryToken('', SECRET)).toBeNull();
  });

  it('verify rejects tampered payload (signature mismatch)', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const t = signRecoveryToken({ paymentId: 'p1', userId: 'u1', method: 'sbp', exp }, SECRET);
    // flip last char of the base64url payload portion
    const [pl, sig] = t.split('.');
    const tampered = `${pl.slice(0, -1)}${pl.at(-1) === 'a' ? 'b' : 'a'}.${sig}`;
    expect(verifyRecoveryToken(tampered, SECRET)).toBeNull();
  });
});
