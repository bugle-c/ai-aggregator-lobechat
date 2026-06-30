import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';
import { useLocation } from 'react-router-dom';

import PageTitle from '@/components/PageTitle';
import MobileGlobalHeader from '@/features/MobileGlobalHeader';
import NavHeader from '@/features/NavHeader';
import { BalanceBadge, FirstMessageToast, WelcomeModal } from '@/features/Onboarding';
import { UIModeToggle } from '@/features/UIMode';
import WideScreenContainer from '@/features/WideScreenContainer';
import WideScreenButton from '@/features/WideScreenContainer/WideScreenButton';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import HomeContent from './features';
import FunnelHero from './features/FunnelHero';
import HomePresetSection from './features/HomePresetSection';
import HomeVideoSection from './features/HomeVideoSection';
import InputArea from './features/InputArea';
import QuickActions from './features/QuickActions';

const Home: FC = () => {
  const { pathname } = useLocation();
  const isHomeRoute = pathname === '/';
  const isMobile = useIsMobile();
  const isLogin = useUserStore(authSelectors.isLogin);

  if (isMobile) {
    // Mobile now shows a responsive version of the new desktop design
    // (compact hero + quick actions + image/video presets) instead of the
    // old chat-only MobileHome. The same section components are reused — they
    // read useIsMobile() internally and render compact / horizontally
    // scrollable variants. InputArea renders itself as the bottom overlay.
    return (
      <>
        {isHomeRoute && <PageTitle title="" />}
        <MobileGlobalHeader />
        <Flexbox height={'100%'} style={{ overflowY: 'auto', paddingBottom: 160 }} width={'100%'}>
          <Flexbox gap={28} paddingBlock={8}>
            <Flexbox gap={20}>
              <FunnelHero />
              <QuickActions />
            </Flexbox>
            <Flexbox gap={28}>
              <HomePresetSection modality="image" />
              <HomeVideoSection />
            </Flexbox>
          </Flexbox>
          {/* Bottom-overlay chat input (portals to body). */}
          <InputArea />
          {isLogin && <WelcomeModal />}
          {isLogin && <FirstMessageToast />}
        </Flexbox>
      </>
    );
  }

  return (
    <>
      {isHomeRoute && <PageTitle title="" />}
      <NavHeader
        right={
          <Flexbox horizontal align={'center'} gap={8}>
            <UIModeToggle />
            <BalanceBadge />
            <WideScreenButton />
          </Flexbox>
        }
      />
      <Flexbox height={'100%'} style={{ overflowY: 'auto', paddingBottom: '16vh' }} width={'100%'}>
        <WideScreenContainer>
          <HomeContent />
        </WideScreenContainer>
      </Flexbox>
    </>
  );
};

export default Home;
