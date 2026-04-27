import { describe, expect, it } from 'vitest';

import { readRefCookie } from '../onSignup';

describe('readRefCookie', () => {
  it('extracts a valid 8-char code from a single-cookie header', () => {
    expect(readRefCookie('_ref=abc12def')).toBe('abc12def');
  });

  it('extracts the value from a header with multiple cookies', () => {
    expect(readRefCookie('foo=bar; _ref=zzz9aaa1; baz=qux')).toBe('zzz9aaa1');
    // Leading cookie position
    expect(readRefCookie('_ref=z9z9z9z9; sid=hello')).toBe('z9z9z9z9');
  });

  it('returns null when cookie is missing', () => {
    expect(readRefCookie('foo=bar; baz=qux')).toBeNull();
    expect(readRefCookie('')).toBeNull();
    expect(readRefCookie(null)).toBeNull();
    expect(readRefCookie(undefined)).toBeNull();
  });

  it('rejects malformed values that do not match 8-char [a-z0-9]', () => {
    expect(readRefCookie('_ref=ABC12DEF')).toBeNull(); // uppercase
    expect(readRefCookie('_ref=short')).toBeNull(); // too short
    expect(readRefCookie('_ref=waytoolongvalue')).toBeNull();
    expect(readRefCookie('_ref=abc-1234')).toBeNull(); // hyphen
    expect(readRefCookie('_ref=')).toBeNull();
  });

  it('does not confuse with cookie names that contain "_ref" as substring', () => {
    expect(readRefCookie('xx_ref=abcdefgh')).toBeNull();
    expect(readRefCookie('preref=abcdefgh; sid=hi')).toBeNull();
  });
});
