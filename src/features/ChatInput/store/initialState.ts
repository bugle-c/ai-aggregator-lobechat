import { type IEditor, type SlashOptions } from '@lobehub/editor';
import { type ChatInputProps } from '@lobehub/editor/react';
import { type MenuProps } from '@lobehub/ui';
import { type ReactNode } from 'react';

import { type ActionKeys } from '@/features/ChatInput';

export type SendButtonHandler = (params: {
  clearContent: () => void;
  editor: IEditor;
  getMarkdownContent: () => string;
}) => Promise<void> | void;

export interface SendButtonProps {
  disabled?: boolean;
  generating: boolean;
  onStop: (params: { editor: IEditor }) => void;
  shape?: 'round' | 'default';
  size?: number;
}

export const initialSendButtonState: SendButtonProps = {
  disabled: false,
  generating: false,
  onStop: () => {},
};

export interface PublicState {
  agentId?: string;
  allowExpand?: boolean;
  expand?: boolean;
  leftActions: ActionKeys[];
  mentionItems?: SlashOptions['items'];
  mobile?: boolean;
  onMarkdownContentChange?: (content: string) => void;
  onSend?: SendButtonHandler;
  /**
   * Optional override for the editor placeholder. When provided, the editor
   * renders this node instead of the default <Placeholder/> (used by the home
   * chat input for a shorter, home-only prompt). Falls back to the default
   * everywhere it is not passed, so shared chat surfaces are unaffected.
   */
  placeholder?: ReactNode;
  rightActions: ActionKeys[];
  sendButtonProps?: SendButtonProps;
  sendMenu?: MenuProps;
  showTypoBar?: boolean;
}

export interface State extends PublicState {
  editor?: IEditor;
  isContentEmpty: boolean;
  markdownContent: string;
  slashMenuRef: ChatInputProps['slashMenuRef'];
}

export const initialState: State = {
  allowExpand: true,
  expand: false,
  isContentEmpty: false,
  leftActions: [],
  markdownContent: '',
  rightActions: [],
  slashMenuRef: { current: null },
};
