'use client';

import { Button } from 'antd';
import { memo } from 'react';

import { useSend } from '@/app/[variants]/(main)/home/features/InputArea/useSend';
import { reachGoal } from '@/business/client/analytics/ym';
import { lambdaQuery } from '@/libs/trpc/client';
import { useChatStore } from '@/store/chat';

import { INTENT_CHIPS, type IntentChip } from './intentChips';

/**
 * Focus the main chat editor once it exists. The editor mounts after
 * hydration and the modal has a ~200ms close animation, so poll a few
 * frames. Self-clearing: gives up after ~10s.
 */
const focusEditor = () => {
  let tries = 0;
  const timer = setInterval(() => {
    const editor = useChatStore.getState().mainInputEditor;
    tries += 1;
    if (editor) {
      editor.focus();
      clearInterval(timer);
    } else if (tries > 40) {
      clearInterval(timer);
    }
  }, 250);
};

interface IntentChipsProps {
  /** Close the hosting modal (WelcomeModal's handleClose). */
  onDone: () => void;
}

/**
 * The «Что делаем?» intent screen: four task chips in a 2×2 grid.
 * Picking one records the intent (fire-and-forget), closes the modal and
 * — for the three task chips — sends a complete prompt right away through
 * the regular home send path, so the first reply starts streaming after a
 * single tap. «Просто спросить» only closes the modal and focuses the input.
 */
const IntentChips = memo<IntentChipsProps>(({ onDone }) => {
  const setIntent = lambdaQuery.userOnboarding.setIntent.useMutation();
  const { sendPrompt } = useSend();

  const handleClick = (chip: IntentChip) => {
    const mode = chip.prompt ? 'send' : 'focus';
    reachGoal('chip_click', { intent: chip.id, mode });
    // Fire-and-forget: the modal must close instantly even if the network is slow.
    setIntent.mutate({ intent: chip.id });
    onDone();
    if (chip.prompt) {
      // Still inside the user gesture — send now; the promise resolves after
      // navigation to the chat and is intentionally not awaited.
      void sendPrompt(chip.prompt);
    } else {
      focusEditor();
    }
  };

  return (
    <div
      style={{
        display: 'grid',
        gap: 8,
        gridTemplateColumns: '1fr 1fr',
        width: '100%',
      }}
    >
      {INTENT_CHIPS.map((chip) => (
        <Button
          key={chip.id}
          size="large"
          style={{
            height: 'auto',
            minHeight: 56,
            paddingBlock: 12,
            paddingInline: 12,
            whiteSpace: 'normal',
          }}
          onClick={() => handleClick(chip)}
        >
          {chip.label}
        </Button>
      ))}
    </div>
  );
});

IntentChips.displayName = 'OnboardingIntentChips';

export default IntentChips;
