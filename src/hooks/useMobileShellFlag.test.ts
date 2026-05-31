/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useMobileShellFlag } from './useMobileShellFlag';

const setUrl = (search: string) => {
  // happy-dom lets us replace location.href via history API.
  window.history.replaceState({}, '', `/${search}`);
};

describe('useMobileShellFlag', () => {
  beforeEach(() => {
    localStorage.clear();
    setUrl('');
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('defaults to enabled when no URL param and no localStorage', () => {
    const { result } = renderHook(() => useMobileShellFlag());
    expect(result.current).toBe(true);
  });

  it('returns false when localStorage has off', () => {
    localStorage.setItem('mobile-shell-v2', 'off');
    const { result } = renderHook(() => useMobileShellFlag());
    expect(result.current).toBe(false);
  });

  it('URL ?mobile-shell=off overrides and persists to localStorage', () => {
    setUrl('?mobile-shell=off');
    const { result } = renderHook(() => useMobileShellFlag());
    expect(result.current).toBe(false);
    expect(localStorage.getItem('mobile-shell-v2')).toBe('off');
  });

  it('URL ?mobile-shell=on overrides and persists to localStorage', () => {
    localStorage.setItem('mobile-shell-v2', 'off');
    setUrl('?mobile-shell=on');
    const { result } = renderHook(() => useMobileShellFlag());
    expect(result.current).toBe(true);
    expect(localStorage.getItem('mobile-shell-v2')).toBe('on');
  });

  it('ignores garbage URL param values', () => {
    setUrl('?mobile-shell=garbage');
    localStorage.setItem('mobile-shell-v2', 'off');
    const { result } = renderHook(() => useMobileShellFlag());
    // Falls through to localStorage, which says off.
    expect(result.current).toBe(false);
  });
});
