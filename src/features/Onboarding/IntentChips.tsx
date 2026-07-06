'use client';

import { Button } from 'antd';
import { memo } from 'react';

import { reachGoal } from '@/business/client/analytics/ym';
import { lambdaQuery } from '@/libs/trpc/client';
import { useChatStore } from '@/store/chat';

export type OnboardingIntent = 'ask' | 'doc' | 'essay' | 'post';

interface IntentChip {
  id: OnboardingIntent;
  label: string;
  /** Prompt template prefilled into the main editor. Empty = just close. */
  template: string;
}

const CHIPS: IntentChip[] = [
  {
    id: 'post',
    label: '📣 Пост и картинка для соцсетей',
    template: 'Напиши продающий пост для ВК: {услуга}, {акция}, {срок} — живым языком, с эмодзи',
  },
  {
    id: 'doc',
    label: '📄 Договор / претензия / письмо',
    template: 'Составь {документ} для {ситуация} — со ссылками на законы РФ, деловым языком',
  },
  {
    id: 'essay',
    label: '🎓 Эссе / объяснить тему',
    template:
      'Напиши эссе на тему {тема} по критериям ЕГЭ, а потом перепиши как обычный старшеклассник',
  },
  {
    id: 'ask',
    label: '💬 Просто спросить',
    template: '',
  },
];

/**
 * Prefill the main chat editor with a template. The editor mounts after
 * hydration, so poll a few frames — same pattern as useIntentPrompt's
 * inject phase. Self-clearing: gives up after ~10s.
 */
const prefillEditor = (template: string) => {
  let tries = 0;
  const timer = setInterval(() => {
    const editor = useChatStore.getState().mainInputEditor;
    tries += 1;
    if (editor) {
      editor.instance?.setDocument('markdown', template);
      useChatStore.setState({ inputMessage: template });
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
 * Picking one records the intent (fire-and-forget), closes the modal
 * and charges the input with a ready-to-edit prompt template.
 */
const IntentChips = memo<IntentChipsProps>(({ onDone }) => {
  const setIntent = lambdaQuery.userOnboarding.setIntent.useMutation();

  const handleClick = (chip: IntentChip) => {
    reachGoal('chip_click', { intent: chip.id });
    // Fire-and-forget: the modal must close instantly even if the network is slow.
    setIntent.mutate({ intent: chip.id });
    onDone();
    if (chip.template) prefillEditor(chip.template);
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
      {CHIPS.map((chip) => (
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
