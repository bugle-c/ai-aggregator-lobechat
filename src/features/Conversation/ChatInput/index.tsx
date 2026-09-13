'use client';

import { type SlashOptions } from '@lobehub/editor';
import { type ChatInputActionsProps } from '@lobehub/editor/react';
import { type MenuProps } from '@lobehub/ui';
import { Alert, Flexbox } from '@lobehub/ui';
import { type ReactNode } from 'react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { reachGoal } from '@/business/client/analytics/ym';
import CreditsExhaustedModal from '@/components/CreditsExhaustedModal';
import LowBalanceWarning from '@/components/LowBalanceWarning';
import { type ActionKeys } from '@/features/ChatInput';
import { ChatInputProvider, DesktopChatInput } from '@/features/ChatInput';
import {
  type SendButtonHandler,
  type SendButtonProps,
} from '@/features/ChatInput/store/initialState';
import { useChatStore } from '@/store/chat';
import { aiChatSelectors } from '@/store/chat/selectors';
import { fileChatSelectors, useFileStore } from '@/store/file';

import WideScreenContainer from '../../WideScreenContainer';
import { messageStateSelectors, useConversationStore, useConversationStoreApi } from '../store';
import {
  clearDraft,
  draftStashKey,
  isCreditsExhaustedError,
  readDraft,
  stashDraft,
} from './draftStash';

export interface ChatInputProps {
  /**
   * Custom style for the action bar container
   */
  actionBarStyle?: React.CSSProperties;
  /**
   * Whether to allow fullscreen expand button
   */
  allowExpand?: boolean;
  /**
   * Custom children to render instead of default Desktop component.
   * Use this to add custom UI like error alerts, MessageFromUrl, etc.
   */
  children?: ReactNode;
  /**
   * Extra action items to append to the ActionBar
   */
  extraActionItems?: ChatInputActionsProps['items'];
  /**
   * Left action buttons configuration
   */
  leftActions?: ActionKeys[];
  /**
   * Custom left content to replace the default ActionBar entirely
   */
  leftContent?: ReactNode;
  /**
   * Mention items for @ mentions (for group chat)
   */
  mentionItems?: SlashOptions['items'];
  /**
   * Callback when editor instance is ready
   */
  onEditorReady?: (editor: any) => void;
  /**
   * Right action buttons configuration
   */
  rightActions?: ActionKeys[];
  /**
   * Custom content to render before the SendArea (right side of action bar)
   */
  sendAreaPrefix?: ReactNode;
  /**
   * Custom send button props override
   */
  sendButtonProps?: Partial<SendButtonProps>;
  /**
   * Send menu configuration (for send options like Enter/Cmd+Enter, Add AI/User message)
   */
  sendMenu?: MenuProps;
  /**
   * Remove a small margin when placed adjacent to the ChatList
   */
  skipScrollMarginWithList?: boolean;
}

/**
 * ChatInput component for Conversation
 *
 * Uses ConversationStore for state management instead of global ChatStore.
 * Reuses the UI components from @/features/ChatInput.
 */
const ChatInput = memo<ChatInputProps>(
  ({
    actionBarStyle,
    allowExpand,
    leftActions = [],
    leftContent,
    rightActions = [],
    children,
    extraActionItems,
    mentionItems,
    sendMenu,
    sendAreaPrefix,
    sendButtonProps: customSendButtonProps,
    onEditorReady,
    skipScrollMarginWithList,
  }) => {
    const { t } = useTranslation('chat');

    // ConversationStore state
    const [agentId, topicId, inputMessage, sendMessage, stopGenerating] = useConversationStore(
      (s) => [
        s.context.agentId,
        s.context.topicId,
        s.inputMessage,
        s.sendMessage,
        s.stopGenerating,
      ],
    );
    const updateInputMessage = useConversationStore((s) => s.updateInputMessage);
    const setEditor = useConversationStore((s) => s.setEditor);
    const editor = useConversationStore((s) => s.editor);
    const conversationStoreApi = useConversationStoreApi();

    // Generation state from ConversationStore (bridged from ChatStore)
    const isAIGenerating = useConversationStore(messageStateSelectors.isAIGenerating);

    // Send message error from ConversationStore
    const sendMessageErrorMsg = useConversationStore(messageStateSelectors.sendMessageError);
    const clearSendMessageError = useChatStore((s) => s.clearSendMessageError);

    // Credits exhausted modal state
    const [showExhaustedModal, setShowExhaustedModal] = useState(false);

    // Show modal when sendMessageError contains credit exhaustion message
    useEffect(() => {
      if (isCreditsExhaustedError(sendMessageErrorMsg)) {
        setShowExhaustedModal(true);
        reachGoal('paywall_view', { source: 'credits_exhausted' });
      }
    }, [sendMessageErrorMsg]);

    // Draft preservation: a send that died on the paywall left its text in
    // sessionStorage (see draftStash.ts). After the YooKassa round-trip the
    // page reloads into this same conversation — put the draft back into
    // the (empty) editor once, then forget it.
    useEffect(() => {
      if (!editor || !agentId) return;
      const key = draftStashKey(agentId, topicId);
      const draft = readDraft(key);
      if (!draft) return;
      clearDraft(key);
      if (conversationStoreApi.getState().inputMessage.trim()) return;
      editor.setDocument?.('markdown', draft);
      updateInputMessage(draft);
    }, [editor, agentId, topicId, conversationStoreApi, updateInputMessage]);

    // Contextual paywall: path YooKassa returns the payer to after checkout,
    // so they land back in this exact conversation (topic may be null for a
    // fresh chat — omit the query param then).
    const paywallReturnPath = agentId
      ? `/agent/${agentId}${topicId ? `?topic=${topicId}` : ''}`
      : undefined;

    // File store - for UI state only (disabled button, etc.)
    const fileList = useFileStore(fileChatSelectors.chatUploadFileList);
    const contextList = useFileStore(fileChatSelectors.chatContextSelections);
    const isUploadingFiles = useFileStore(fileChatSelectors.isUploadingFiles);

    // Computed state
    const isInputEmpty = !inputMessage.trim() && fileList.length === 0 && contextList.length === 0;
    const disabled = isInputEmpty || isUploadingFiles || isAIGenerating;

    // Send handler - gets message, clears editor immediately, then sends
    const handleSend: SendButtonHandler = useCallback(
      async ({ clearContent, getMarkdownContent }) => {
        // Get instant values from stores at trigger time
        const fileStore = useFileStore.getState();
        const currentFileList = fileChatSelectors.chatUploadFileList(fileStore);
        const currentIsUploading = fileChatSelectors.isUploadingFiles(fileStore);
        const currentContextList = fileChatSelectors.chatContextSelections(fileStore);

        if (currentIsUploading || isAIGenerating) return;

        // Get content before clearing
        const message = getMarkdownContent();
        if (!message.trim() && currentFileList.length === 0 && currentContextList.length === 0)
          return;

        // Clear content immediately for responsive UX
        clearContent();
        fileStore.clearChatUploadFileList();
        fileStore.clearChatContextSelections();

        // Convert ChatContextContent to PageSelection for persistence
        const pageSelections = currentContextList.map((ctx) => ({
          content: ctx.preview || '',
          id: ctx.id,
          pageId: ctx.pageId || '',
          xml: ctx.content,
        }));

        // Keep the text until we know the send did not die on the paywall:
        // the credits-exhausted path redirects to YooKassa and back (page
        // reload), and the restore effect above refills the editor.
        const draftKey = agentId ? draftStashKey(agentId, topicId) : null;
        if (draftKey) stashDraft(draftKey, message);

        // Fire and forget - send with captured message
        await sendMessage({ files: currentFileList, message, pageSelections });

        if (draftKey) {
          const err = aiChatSelectors.isCurrentSendMessageError(useChatStore.getState());
          if (!isCreditsExhaustedError(err)) clearDraft(draftKey);
        }
      },
      [agentId, isAIGenerating, sendMessage, topicId],
    );

    const sendButtonProps: SendButtonProps = {
      disabled,
      generating: isAIGenerating,
      onStop: stopGenerating,
      ...customSendButtonProps,
    };

    const defaultContent = (
      <WideScreenContainer style={skipScrollMarginWithList ? { marginTop: -12 } : undefined}>
        <LowBalanceWarning />
        {sendMessageErrorMsg && (
          <Flexbox paddingBlock={'0 6px'} paddingInline={12}>
            <Alert
              closable
              title={t('input.errorMsg', { errorMsg: sendMessageErrorMsg })}
              type={'secondary'}
              onClose={clearSendMessageError}
            />
          </Flexbox>
        )}
        <DesktopChatInput
          actionBarStyle={actionBarStyle}
          borderRadius={12}
          extraActionItems={extraActionItems}
          leftContent={leftContent}
          sendAreaPrefix={sendAreaPrefix}
        />
      </WideScreenContainer>
    );

    return (
      <>
        <ChatInputProvider
          agentId={agentId}
          allowExpand={allowExpand}
          leftActions={leftActions}
          mentionItems={mentionItems}
          rightActions={rightActions}
          sendButtonProps={sendButtonProps}
          sendMenu={sendMenu}
          chatInputEditorRef={(instance) => {
            if (instance) {
              setEditor(instance);
              onEditorReady?.(instance);
            }
          }}
          onMarkdownContentChange={updateInputMessage}
          onSend={handleSend}
        >
          {children ?? defaultContent}
        </ChatInputProvider>
        <CreditsExhaustedModal
          contextNote="Ваш диалог сохранён — после оплаты вы вернётесь ровно сюда"
          open={showExhaustedModal}
          returnPath={paywallReturnPath}
          onClose={() => setShowExhaustedModal(false)}
        />
      </>
    );
  },
);

ChatInput.displayName = 'ConversationChatInput';

export default ChatInput;
