import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import IntentChips from './IntentChips';
import { INTENT_CHIPS } from './intentChips';

const mockSendPrompt = vi.fn(async () => {});
const mockSetIntent = vi.fn();
const mockReachGoal = vi.fn();
const mockFocus = vi.fn();

vi.mock('@/app/[variants]/(main)/home/features/InputArea/useSend', () => ({
  useSend: () => ({ sendPrompt: mockSendPrompt }),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    userOnboarding: {
      setIntent: { useMutation: () => ({ mutate: mockSetIntent }) },
    },
  },
}));

vi.mock('@/business/client/analytics/ym', () => ({
  reachGoal: (...args: unknown[]) => mockReachGoal(...args),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: {
    getState: () => ({ mainInputEditor: { focus: mockFocus } }),
    setState: vi.fn(),
  },
}));

const chip = (id: string) => INTENT_CHIPS.find((c) => c.id === id)!;

describe('IntentChips', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('ships four chips: three complete prompts without placeholders and one «just ask»', () => {
    expect(INTENT_CHIPS.map((c) => c.id)).toEqual(['post', 'doc', 'essay', 'ask']);
    for (const c of INTENT_CHIPS.filter((c) => c.id !== 'ask')) {
      expect(c.prompt.length).toBeGreaterThan(80);
      expect(c.prompt).not.toMatch(/[{}]/);
    }
    expect(chip('ask').prompt).toBe('');
  });

  it.each(['post', 'doc', 'essay'])(
    'tapping the %s chip records the intent, closes the modal and sends the prompt',
    (id) => {
      const onDone = vi.fn();
      render(<IntentChips onDone={onDone} />);

      fireEvent.click(screen.getByText(chip(id).label));

      expect(mockReachGoal).toHaveBeenCalledWith('chip_click', { intent: id, mode: 'send' });
      expect(mockSetIntent).toHaveBeenCalledWith({ intent: id });
      expect(onDone).toHaveBeenCalledTimes(1);
      expect(mockSendPrompt).toHaveBeenCalledTimes(1);
      expect(mockSendPrompt).toHaveBeenCalledWith(chip(id).prompt);
    },
  );

  it('«Просто спросить» closes the modal and focuses the input without sending', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<IntentChips onDone={onDone} />);

    fireEvent.click(screen.getByText(chip('ask').label));

    expect(mockReachGoal).toHaveBeenCalledWith('chip_click', { intent: 'ask', mode: 'focus' });
    expect(mockSetIntent).toHaveBeenCalledWith({ intent: 'ask' });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(mockSendPrompt).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(mockFocus).toHaveBeenCalledTimes(1);
  });
});
