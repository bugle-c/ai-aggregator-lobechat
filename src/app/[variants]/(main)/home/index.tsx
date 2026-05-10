import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';
import { useLocation } from 'react-router-dom';

import PageTitle from '@/components/PageTitle';
import MobileGlobalHeader from '@/features/MobileGlobalHeader';
import MobileHome from '@/features/MobileHome';
import NavHeader from '@/features/NavHeader';
import { BalanceBadge, FirstMessageToast, WelcomeModal } from '@/features/Onboarding';
import { UIModeToggle } from '@/features/UIMode';
import WideScreenContainer from '@/features/WideScreenContainer';
import WideScreenButton from '@/features/WideScreenContainer/WideScreenButton';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useChatStore } from '@/store/chat';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import HomeContent from './features';
import InputArea from './features/InputArea';
import { useSend } from './features/InputArea/useSend';

const Home: FC = () => {
  const { pathname } = useLocation();
  const isHomeRoute = pathname === '/';
  const isMobile = useIsMobile();
  const isLogin = useUserStore(authSelectors.isLogin);
  const { send } = useSend();

  const handlePromptSelect = async (prompt: string) => {
    const editor = useChatStore.getState().mainInputEditor;
    editor?.instance?.setDocument('markdown', prompt);
    useChatStore.setState({ inputMessage: prompt });
    editor?.focus();
    await send();
  };

  if (isMobile) {
    return (
      <>
        {isHomeRoute && <PageTitle title="" />}
        <MobileGlobalHeader />
        <Flexbox
          height={'100%'}
          style={{ overflowY: 'auto', paddingBottom: '16vh' }}
          width={'100%'}
        >
          <MobileHome onSelectPrompt={handlePromptSelect} />
          {/* Render ONLY the chat editor on mobile — `SuggestedPrompts`
              auto-send writes through the same editor instance, so we
              still need it mounted. The desktop modules (WelcomeText,
              RecentTopic / RecentPage / CommunityAgents / RecentResource,
              second WelcomeModal) are intentionally dropped per spec
              — they duplicate the greeting and don't fit on a phone. */}
          <Flexbox paddingInline={16}>
            <InputArea />
          </Flexbox>
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
