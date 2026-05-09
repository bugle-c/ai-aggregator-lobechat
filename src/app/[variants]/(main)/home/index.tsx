import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';
import { useLocation } from 'react-router-dom';

import PageTitle from '@/components/PageTitle';
import MobileGlobalHeader from '@/features/MobileGlobalHeader';
import MobileHome from '@/features/MobileHome';
import NavHeader from '@/features/NavHeader';
import { BalanceBadge } from '@/features/Onboarding';
import { UIModeToggle } from '@/features/UIMode';
import WideScreenContainer from '@/features/WideScreenContainer';
import WideScreenButton from '@/features/WideScreenContainer/WideScreenButton';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useChatStore } from '@/store/chat';

import HomeContent from './features';
import { useSend } from './features/InputArea/useSend';

const Home: FC = () => {
  const { pathname } = useLocation();
  const isHomeRoute = pathname === '/';
  const isMobile = useIsMobile();
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
          {/* InputArea hosts the chat editor used by SuggestedPrompts auto-send.
              Power-user surfaces (RecentTopic / RecentPage / CommunityAgents) are
              intentionally omitted on mobile per spec. */}
          <HomeContent />
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
