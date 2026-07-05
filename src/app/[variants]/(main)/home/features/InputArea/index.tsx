import { Flexbox } from '@lobehub/ui';
import { useTheme } from 'antd-style';
import { AnimatePresence, m as motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import DragUploadZone, { useUploadFiles } from '@/components/DragUploadZone';
import { type ActionKeys } from '@/features/ChatInput';
import { ChatInputProvider, DesktopChatInput } from '@/features/ChatInput';
import { SuggestedPrompts } from '@/features/Onboarding';
import { useIsLightMode } from '@/features/UIMode';
import { useIsDark } from '@/hooks/useIsDark';
import { useIsMobile } from '@/hooks/useIsMobile';
import { lambdaQuery } from '@/libs/trpc/client';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import CommunityRecommend from '../CommunityRecommend';
import HomeChips from '../HomeChips';
import SuggestQuestions from '../SuggestQuestions';
import ModeTag from './ModeTag';
import SkillInstallBanner from './SkillInstallBanner';
import { useInitStarterAgents } from './useInitStarterAgents';
import { useIntentPrompt } from './useIntentPrompt';
import { useSend } from './useSend';

const leftActionsFull: ActionKeys[] = ['model', 'search', 'fileUpload', 'tools'];
const leftActionsLight: ActionKeys[] = ['model', 'search', 'fileUpload'];

const InputArea = () => {
  const { t } = useTranslation('home');
  const { loading, send, inboxAgentId } = useSend();
  // Keep the starter builtin agents (agent / group / write) initialised even
  // though the redundant starter buttons are no longer rendered — the modes are
  // triggered from the home quick-action cards.
  useInitStarterAgents();
  // Blog CTAs deep-link with `?prompt=` — prefill the editor once it mounts.
  useIntentPrompt();
  const theme = useTheme();
  const isLight = useIsLightMode();
  const isDark = useIsDark();
  const isMobile = useIsMobile();
  // Subscribe to sidebar state so the overlay re-measures immediately when the
  // nav panel toggles or is resized.
  const showLeftPanel = useGlobalStore(systemStatusSelectors.showLeftPanel);
  const leftPanelWidth = useGlobalStore(systemStatusSelectors.leftPanelWidth);
  const leftActions = isLight ? leftActionsLight : leftActionsFull;
  const inputActiveMode = useHomeStore((s) => s.inputActiveMode);
  const isLobehubSkillEnabled = useServerConfigStore(serverConfigSelectors.enableLobehubSkill);
  const isKlavisEnabled = useServerConfigStore(serverConfigSelectors.enableKlavis);
  const showSkillBanner = isLobehubSkillEnabled || isKlavisEnabled;
  const chatInputRef = useRef<HTMLDivElement>(null);

  // Portal target is document.body so the fixed overlay is anchored to the
  // viewport, NOT to a transformed/contained ancestor (the home tree lives
  // inside <Activity> + WideScreenContainer which can establish a containing
  // block for position:fixed). SSR guard: only mount the portal after the
  // client has hydrated.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Scroll-aware overlay: visible at the top of the page, slides away when the
  // user scrolls DOWN (so it stops covering the galleries), and returns on
  // scroll UP or back at the top. A capture-phase scroll listener catches the
  // inner scroll container (the home content area) without pinning its selector.
  const [scrollHidden, setScrollHidden] = useState(false);
  const lastScrollTop = useRef(0);
  useEffect(() => {
    const onScroll = (e: Event) => {
      const tgt = e.target as Document | HTMLElement;
      const el = (tgt === document ? document.scrollingElement : tgt) as HTMLElement | null;
      const top = el?.scrollTop ?? 0;
      const last = lastScrollTop.current;
      if (top <= 48)
        setScrollHidden(false); // at the top → always show
      else if (top > last + 6)
        setScrollHidden(true); // scrolling down → hide
      else if (top < last - 6) setScrollHidden(false); // scrolling up → show
      lastScrollTop.current = top;
    };
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, []);

  // Align the fixed overlay to the real content area (right of the nav panel),
  // not the whole viewport. Measure the content region and keep it in sync as
  // the sidebar collapses/expands (DraggablePanel animates its width, so the
  // ResizeObserver fires throughout) and on window resize.
  const [contentRect, setContentRect] = useState<{ left: number; width: number } | null>(null);
  useEffect(() => {
    const el = document.querySelector('[data-home-content-area]') as HTMLElement | null;
    if (!el) {
      setContentRect(null);
      return;
    }
    const measure = () => {
      const r = el.getBoundingClientRect();
      setContentRect((prev) =>
        prev &&
        Math.round(prev.left) === Math.round(r.left) &&
        Math.round(prev.width) === Math.round(r.width)
          ? prev
          : { left: r.left, width: r.width },
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
    // Re-run when the sidebar toggles/resizes so we re-bind + re-measure promptly.
  }, [showLeftPanel, leftPanelWidth]);

  // When a starter mode is activated (e.g. Create Agent / Create Group / Write),
  // re-focus the editor and scroll it into view so the user can type immediately.
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
      // Resting height ~ one tidy line; grows as the user types.
      minHeight: 48,
      resize: false,
      style: {
        borderRadius: 16,
        boxShadow: 'none',
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
    const editor = useChatStore.getState().mainInputEditor;
    editor?.instance?.setDocument('markdown', prompt);
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

  // The inner input + chips block, shared between the fixed overlay and the
  // (rare) SSR/pre-mount fallback path.
  const inner = (
    <Flexbox data-home-input-area gap={12}>
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
            placeholder={t('chatPlaceholder')}
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
              dropdownPlacement="topLeft"
              extraActionItems={extraActionItems}
              inputContainerProps={inputContainerProps}
            />
          </ChatInputProvider>
        </DragUploadZone>
      </Flexbox>

      {showOnboardingPrompts && <SuggestedPrompts onSelect={handlePromptSelect} />}
      {/* Multimodal suggestion chips (text/image/video) — always under the
          input except while a starter mode owns the surface. */}
      {!inputActiveMode && !showOnboardingPrompts && <HomeChips />}
      {/* The redundant create-agent / create-group / write starter buttons were
          removed (they duplicate the home quick-action cards). The builtin
          agents they relied on are kept warm via useInitStarterAgents() above. */}
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

  // Fixed bottom overlay: floats ~100px above the viewport bottom (desktop),
  // tighter on mobile, centered and capped to the conversation width so the
  // galleries scroll behind it. Rendered via portal to document.body to dodge
  // the transformed/contained-ancestor fixed-positioning pitfall.
  // Hide on scroll-down, but never while a starter mode owns the input.
  const overlayHidden = scrollHidden && !inputActiveMode;
  // On desktop, anchor to the measured content area (right of NavPanel). When we
  // couldn't measure (mobile / element absent) fall back to full-viewport.
  const useMeasured = !isMobile && contentRect != null;
  const overlay = (
    <div
      style={{
        bottom: isMobile ? 16 : 100,
        display: 'flex',
        justifyContent: 'center',
        left: useMeasured ? contentRect!.left : 0,
        paddingInline: 16,
        pointerEvents: 'none',
        position: 'fixed',
        right: useMeasured ? undefined : 0,
        width: useMeasured ? contentRect!.width : undefined,
        zIndex: 50,
      }}
    >
      <div
        style={{
          // Semi-translucent elevated surface + blur → polished floating command
          // bar. Falls back to the opaque elevated colour when blur is absent.
          backdropFilter: 'blur(20px) saturate(180%)',
          background: isDark ? 'rgba(28, 28, 30, 0.72)' : 'rgba(255, 255, 255, 0.78)',
          border: `1px solid ${theme.colorBorderSecondary}`,
          borderRadius: 24,
          boxShadow: isDark
            ? '0 8px 28px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.3)'
            : '0 8px 24px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04)',
          maxHeight: 'calc(100dvh - 140px)',
          maxWidth: 760,
          opacity: overlayHidden ? 0 : 1,
          overflowY: 'auto',
          padding: 12,
          pointerEvents: overlayHidden ? 'none' : 'auto',
          transform: overlayHidden ? 'translateY(140%)' : 'translateY(0)',
          transition: 'transform 0.28s ease, opacity 0.28s ease',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          width: '100%',
        }}
      >
        {inner}
      </div>
    </div>
  );

  if (!mounted) return null;

  // Portal into `.ant-app` (not document.body) so the overlay inherits the
  // antd theme CSS variables — portaling to bare body left the chat box
  // transparent/invisible (lesson from the mobile-tabbar fix). `.ant-app`
  // is not a transformed/contained ancestor, so position:fixed still anchors
  // to the viewport. Fall back to body if it's somehow absent.
  const portalTarget = document.querySelector('.ant-app') ?? document.body;

  return createPortal(overlay, portalTarget);
};

export default InputArea;
