import { Flexbox } from '@lobehub/ui';
import { AnimatePresence, m as motion } from 'motion/react';
import { useEffect, useMemo, useRef } from 'react';

import DragUploadZone, { useUploadFiles } from '@/components/DragUploadZone';
import { type ActionKeys } from '@/features/ChatInput';
import { ChatInputProvider, DesktopChatInput } from '@/features/ChatInput';
import { SuggestedPrompts } from '@/features/Onboarding';
import { useIsLightMode } from '@/features/UIMode';
import { lambdaQuery } from '@/libs/trpc/client';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { useHomeStore } from '@/store/home';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import CommunityRecommend from '../CommunityRecommend';
import SuggestQuestions from '../SuggestQuestions';
import ModeTag from './ModeTag';
import SkillInstallBanner from './SkillInstallBanner';
import StarterList from './StarterList';
import { useSend } from './useSend';

const leftActionsFull: ActionKeys[] = ['model', 'search', 'fileUpload', 'tools'];
const leftActionsLight: ActionKeys[] = ['model', 'search', 'fileUpload'];

const InputArea = () => {
  const { loading, send, inboxAgentId } = useSend();
  const isLight = useIsLightMode();
  const leftActions = isLight ? leftActionsLight : leftActionsFull;
  const inputActiveMode = useHomeStore((s) => s.inputActiveMode);
  const isLobehubSkillEnabled = useServerConfigStore(serverConfigSelectors.enableLobehubSkill);
  const isKlavisEnabled = useServerConfigStore(serverConfigSelectors.enableKlavis);
  const showSkillBanner = isLobehubSkillEnabled || isKlavisEnabled;
  const chatInputRef = useRef<HTMLDivElement>(null);

  // When a starter mode is activated (e.g. Create Agent / Create Group / Write),
  // the SuggestQuestions panel renders below the ChatInput and may push the total
  // content height beyond the viewport, causing the ChatInput to scroll out of view.
  // Re-focus the editor and scroll it into view so the user can type immediately.
  useEffect(() => {
    if (!inputActiveMode) return;

    requestAnimationFrame(() => {
      chatInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      useChatStore.getState().mainInputEditor?.focus();
    });
  }, [inputActiveMode]);

  // Get agent's model info for vision support check
  const model = useAgentStore((s) => agentByIdSelectors.getAgentModelById(inboxAgentId)(s));
  const provider = useAgentStore((s) =>
    agentByIdSelectors.getAgentModelProviderById(inboxAgentId)(s),
  );
  const { handleUploadFiles } = useUploadFiles({ model, provider });

  // A slot to insert content above the chat input
  // Override some default behavior of the chat input
  const inputContainerProps = useMemo(
    () => ({
      minHeight: 88,
      resize: false,
      style: {
        borderRadius: 20,
        boxShadow: '0 12px 32px rgba(0,0,0,.04)',
      },
    }),
    [],
  );

  const showSuggestQuestions =
    inputActiveMode && ['agent', 'group', 'write'].includes(inputActiveMode);

  const isLogin = useUserStore(authSelectors.isLogin);
  const { data: onboarding } = lambdaQuery.userOnboarding.getOnboardingState.useQuery(undefined, {
    enabled: isLogin,
    staleTime: 60_000,
  });
  // Show onboarding starter prompts only while the user hasn't completed
  // their first message yet — falls back to default UI if state row missing.
  const showOnboardingPrompts =
    isLogin && !inputActiveMode && onboarding != null && !onboarding.firstMessageSeen;

  const handlePromptSelect = async (prompt: string) => {
    // Click on a suggested-prompt card → fire the message immediately.
    // Previous behaviour was to pre-fill the editor and require a second
    // explicit Send click — UX audit found 52% of newly registered users
    // never sent a single message; one-click activation lifts that.
    const editor = useChatStore.getState().mainInputEditor;
    editor?.instance?.setDocument('markdown', prompt);
    // setDocument triggers `onMarkdownContentChange` async; set inputMessage
    // explicitly so `useSend.send()` reads the freshly-typed value rather
    // than the stale empty state.
    useChatStore.setState({ inputMessage: prompt });
    editor?.focus();
    await send();
  };

  const extraActionItems = useMemo(
    () =>
      inputActiveMode
        ? [
            {
              children: <ModeTag />,
              key: 'mode-tag',
            },
          ]
        : [],
    [inputActiveMode],
  );

  return (
    <Flexbox gap={16} style={{ marginBottom: 16 }}>
      <Flexbox
        ref={chatInputRef}
        style={{ paddingBottom: showSkillBanner ? 32 : 0, position: 'relative' }}
      >
        {showSkillBanner && <SkillInstallBanner />}
        <DragUploadZone
          style={{ position: 'relative', zIndex: 1 }}
          onUploadFiles={handleUploadFiles}
        >
          <ChatInputProvider
            agentId={inboxAgentId}
            allowExpand={false}
            leftActions={leftActions}
            chatInputEditorRef={(instance) => {
              if (!instance) return;
              useChatStore.setState({ mainInputEditor: instance });
            }}
            sendButtonProps={{
              disabled: loading,
              generating: loading,
              onStop: () => {},
              shape: 'round',
            }}
            onSend={send}
            onMarkdownContentChange={(content) => {
              useChatStore.setState({ inputMessage: content });
            }}
          >
            <DesktopChatInput
              dropdownPlacement="bottomLeft"
              extraActionItems={extraActionItems}
              inputContainerProps={inputContainerProps}
            />
          </ChatInputProvider>
        </DragUploadZone>
      </Flexbox>

      {showOnboardingPrompts && <SuggestedPrompts onSelect={handlePromptSelect} />}
      {/* Keep StarterList mounted to prevent useInitBuiltinAgent hooks from re-running */}
      {/* Hide create-agent / create-group / write buttons in Light (free) plan */}
      {!isLight && (
        <div style={{ display: showSuggestQuestions ? 'none' : undefined }}>
          <StarterList />
        </div>
      )}
      <AnimatePresence mode="popLayout">
        {showSuggestQuestions && (
          <motion.div
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
            initial={{ opacity: 0, scale: 0.98, y: 8 }}
            key={inputActiveMode}
            transition={{
              duration: 0.2,
              ease: [0.4, 0, 0.2, 1],
            }}
          >
            <Flexbox gap={24}>
              <SuggestQuestions mode={inputActiveMode} />
              <CommunityRecommend mode={inputActiveMode} />
            </Flexbox>
          </motion.div>
        )}
      </AnimatePresence>
    </Flexbox>
  );
};

export default InputArea;
