import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useShowTabBar } from '../useShowTabBar';

vi.mock('@/libs/router/navigation', () => ({ usePathname: () => mockPath }));

let mockPath = '/';

describe('useShowTabBar', () => {
  it('shows on home', () => {
    mockPath = '/';
    const { result } = renderHook(() => useShowTabBar());
    expect(result.current).toBe(true);
  });

  it('hides on chat thread', () => {
    mockPath = '/chat/topic_123';
    const { result } = renderHook(() => useShowTabBar());
    expect(result.current).toBe(false);
  });

  it('shows on /image', () => {
    mockPath = '/image';
    const { result } = renderHook(() => useShowTabBar());
    expect(result.current).toBe(true);
  });

  it('shows on settings sub-pages', () => {
    mockPath = '/settings/profile';
    const { result } = renderHook(() => useShowTabBar());
    expect(result.current).toBe(true);
  });
});
