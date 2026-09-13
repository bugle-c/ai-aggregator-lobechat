import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  INTENT_PROMPT_CONSUMED_KEY,
  INTENT_PROMPT_STORAGE_KEY,
  useIntentPrompt,
} from './useIntentPrompt';

let isLogin = false;
const mockSetDocument = vi.fn();
const mockFocus = vi.fn();
const mockSetState = vi.fn();
const mockReachGoal = vi.fn();

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (s: any) => any) => selector({ isSignedIn: isLogin }),
}));

vi.mock('@/store/user/slices/auth/selectors', () => ({
  authSelectors: { isLogin: (s: any) => s.isSignedIn },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: {
    getState: () => ({
      mainInputEditor: { focus: mockFocus, instance: { setDocument: mockSetDocument } },
    }),
    setState: (...args: unknown[]) => mockSetState(...args),
  },
}));

vi.mock('@/business/client/analytics/ym', () => ({
  reachGoal: (...args: unknown[]) => mockReachGoal(...args),
}));

describe('useIntentPrompt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    sessionStorage.clear();
    isLogin = false;
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('captures ?prompt= into sessionStorage and strips it from the URL for anonymous visitors', () => {
    window.history.replaceState(null, '', '/?prompt=hello%20world&utm_source=blog');

    renderHook(() => useIntentPrompt());

    expect(sessionStorage.getItem(INTENT_PROMPT_STORAGE_KEY)).toBe('hello world');
    expect(window.location.search).toBe('?utm_source=blog');
  });

  it('does NOT inject or consume the pending prompt while logged out', () => {
    sessionStorage.setItem(INTENT_PROMPT_STORAGE_KEY, 'pending prompt');

    renderHook(() => useIntentPrompt());
    vi.advanceTimersByTime(12_000);

    expect(mockSetDocument).not.toHaveBeenCalled();
    expect(mockSetState).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(INTENT_PROMPT_STORAGE_KEY)).toBe('pending prompt');
    expect(sessionStorage.getItem(INTENT_PROMPT_CONSUMED_KEY)).toBeNull();
  });

  it('injects once the user is logged in and marks the prompt consumed', () => {
    isLogin = true;
    sessionStorage.setItem(INTENT_PROMPT_STORAGE_KEY, 'pending prompt');

    renderHook(() => useIntentPrompt());
    vi.advanceTimersByTime(300);

    expect(mockSetDocument).toHaveBeenCalledWith('markdown', 'pending prompt');
    expect(mockSetState).toHaveBeenCalledWith({ inputMessage: 'pending prompt' });
    expect(mockFocus).toHaveBeenCalled();
    expect(mockReachGoal).toHaveBeenCalledWith('prompt_prefill');
    expect(sessionStorage.getItem(INTENT_PROMPT_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(INTENT_PROMPT_CONSUMED_KEY)).toBe('1');
  });

  it('injects after a login that happens while mounted', () => {
    sessionStorage.setItem(INTENT_PROMPT_STORAGE_KEY, 'pending prompt');

    const { rerender } = renderHook(() => useIntentPrompt());
    vi.advanceTimersByTime(1000);
    expect(mockSetDocument).not.toHaveBeenCalled();

    isLogin = true;
    rerender();
    vi.advanceTimersByTime(300);

    expect(mockSetDocument).toHaveBeenCalledWith('markdown', 'pending prompt');
    expect(sessionStorage.getItem(INTENT_PROMPT_STORAGE_KEY)).toBeNull();
  });
});
