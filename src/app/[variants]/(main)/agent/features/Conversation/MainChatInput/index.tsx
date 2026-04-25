'use client';

import { memo } from 'react';

import { type ActionKeys } from '@/features/ChatInput';
import { ChatInput } from '@/features/Conversation';
import { useIsLightMode } from '@/features/UIMode';
import { useChatStore } from '@/store/chat';

import { useSendMenuItems } from './useSendMenuItems';

const leftActionsFull: ActionKeys[] = [
  'model',
  'search',
  'fileUpload',
  'tools',
  '---',
  ['typo', 'params', 'clear'],
  'mainToken',
];

const leftActionsLight: ActionKeys[] = [
  'model',
  'search',
  'fileUpload',
  '---',
  ['typo', 'params', 'clear'],
  'mainToken',
];

const rightActions: ActionKeys[] = [];

/**
 * MainChatInput
 *
 * Custom ChatInput implementation for main chat page.
 * Uses ChatInput from @/features/Conversation which handles all send logic
 * including error alerts display.
 * Only adds MessageFromUrl for desktop mode.
 */
const MainChatInput = memo(() => {
  const sendMenuItems = useSendMenuItems();
  const isLight = useIsLightMode();
  const leftActions = isLight ? leftActionsLight : leftActionsFull;

  return (
    <ChatInput
      skipScrollMarginWithList
      leftActions={leftActions}
      rightActions={rightActions}
      sendMenu={{ items: sendMenuItems }}
      onEditorReady={(instance) => {
        // Sync to global ChatStore for compatibility with other features
        useChatStore.setState({ mainInputEditor: instance });
      }}
    />
  );
});

MainChatInput.displayName = 'MainChatInput';

export default MainChatInput;
