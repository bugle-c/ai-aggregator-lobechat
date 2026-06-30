'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { FirstMessageToast, WelcomeModal } from '@/features/Onboarding';
import { useHomeStore } from '@/store/home';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import FunnelHero from './FunnelHero';
import HomePresetSection from './HomePresetSection';
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
    <Flexbox gap={40}>
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
        <HomePresetSection modality="video" />
      </Flexbox>

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
