'use client';

import { Flexbox } from '@lobehub/ui';
import { Divider } from 'antd';
import { memo } from 'react';

import { SuggestedPrompts } from '@/features/Onboarding';
import { useUserStore } from '@/store/user';

import FeatureChipsRow from './FeatureChipsRow';
import Greeting from './Greeting';
import { useMobileAutofocus } from './useMobileAutofocus';

interface Props {
  /** Tap on a SuggestedPrompts card sends the prompt; same handler as desktop. */
  onSelectPrompt: (prompt: string) => Promise<void> | void;
}

const MobileHome = memo<Props>(({ onSelectPrompt }) => {
  // The onboarding state lives on the unified user store, not a separate
  // store. The plan's reference to `useUserOnboardingStore` doesn't exist
  // in this codebase — we read the same `onboarding` field that
  // `home/features/InputArea/index.tsx` reads via tRPC.
  const onboarding = useUserStore((s) => s.onboarding);
  const firstVisit = onboarding != null && !onboarding.firstMessageSeen;

  useMobileAutofocus({ enabled: firstVisit });

  return (
    <Flexbox gap={16} paddingBlock={8}>
      <Greeting />

      {/* The chat input itself is rendered by the page-level component
          that hosts MobileHome — keeps MobileHome stateless w/r/t the
          editor instance. */}

      <Divider style={{ margin: 0 }}>Быстрые действия</Divider>
      <FeatureChipsRow />

      <Divider style={{ margin: 0 }}>Попробуй</Divider>
      <Flexbox paddingInline={16}>
        <SuggestedPrompts onSelect={onSelectPrompt} showHint={false} />
      </Flexbox>
    </Flexbox>
  );
});

MobileHome.displayName = 'MobileHome';

export default MobileHome;
