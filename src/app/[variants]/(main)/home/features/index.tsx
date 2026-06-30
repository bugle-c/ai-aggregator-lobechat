'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { FirstMessageToast, WelcomeModal } from '@/features/Onboarding';
import { useHomeStore } from '@/store/home';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import FunnelHero from './FunnelHero';
import HomeAssistants from './HomeAssistants';
import HomePresetSection from './HomePresetSection';
import HomeVideoSection from './HomeVideoSection';
import InputArea from './InputArea';
import QuickActions from './QuickActions';
import RecentPage from './RecentPage';
import RecentResource from './RecentResource';
import RecentTopic from './RecentTopic';

const Home = memo(() => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const inputActiveMode = useHomeStore((s) => s.inputActiveMode);

  // Hide other modules when a starter mode is active
  const hideOtherModules = inputActiveMode && ['agent', 'group', 'write'].includes(inputActiveMode);

  return (
    // Bottom padding clears the fixed chat overlay (anchored ~100px above the
    // viewport bottom + the input box height) so nothing is hidden behind it.
    <Flexbox gap={40} style={{ paddingBottom: 240 }}>
      {/* Capability-showcase funnel: hero → quick actions → preset galleries.
          These render regardless of Light/Pro UI mode — they are pure
          navigation and the free (Light) cohort must see them. */}
      <Flexbox gap={32}>
        <FunnelHero />
        <QuickActions />
      </Flexbox>

      {/* Hide the showcase galleries while a starter mode (write/agent) is
          active so the creation surface gets full focus. */}
      <Flexbox gap={40} style={{ display: hideOtherModules ? 'none' : undefined }}>
        <HomePresetSection modality="image" />
        <HomeVideoSection />
        {/* Popular ready-made assistants from the discover marketplace. Pure
            navigation showcase — renders for both Light and Pro UI modes and
            self-hides if the remote list is empty/errors. */}
        <HomeAssistants />
      </Flexbox>

      {/* InputArea renders itself as a fixed bottom overlay (portal to body);
          it must stay mounted here so the editor instance lives. */}
      <InputArea />

      {/* Recent rows demoted to the bottom; they self-hide when empty. */}
      <Flexbox gap={40} style={{ display: hideOtherModules ? 'none' : undefined }}>
        {isLogin && (
          <>
            <RecentTopic />
            <RecentPage />
            <RecentResource />
          </>
        )}
      </Flexbox>

      {isLogin && <WelcomeModal />}
      {isLogin && <FirstMessageToast />}
    </Flexbox>
  );
});

export default Home;
