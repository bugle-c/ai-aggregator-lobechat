'use client';

import { createStyles } from 'antd-style';
import { ImageIcon, type LucideIcon, SparklesIcon, VideoIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { useHomeStore } from '@/store/home';

import { useSend } from '../InputArea/useSend';

const useStyles = createStyles(({ css, token }) => ({
  chip: css`
    cursor: pointer;

    display: inline-flex;
    flex-shrink: 0;
    gap: 6px;
    align-items: center;

    height: 30px;
    padding-inline: 12px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 999px;

    font-size: 13px;
    font-weight: 500;
    line-height: 1;
    color: ${token.colorTextSecondary};

    background: ${token.colorFillQuaternary};

    transition:
      border-color 0.15s ease,
      color 0.15s ease,
      background 0.15s ease;

    &:hover {
      border-color: ${token.colorPrimaryBorderHover};
      color: ${token.colorText};
      background: ${token.colorFillTertiary};
    }
  `,
  icon: css`
    flex-shrink: 0;
    color: ${token.colorTextTertiary};
  `,
  row: css`
    scrollbar-width: none;

    overflow-x: auto;
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: flex-start;

    padding-inline: 4px;

    -webkit-overflow-scrolling: touch;

    &::-webkit-scrollbar {
      display: none;
    }
  `,
}));

type ChipKind = 'text' | 'image' | 'video';

interface ChipDef {
  icon: LucideIcon;
  key: ChipKind;
  labelKey: string;
}

const CHIPS: ChipDef[] = [
  { icon: SparklesIcon, key: 'text', labelKey: 'chips.text' },
  { icon: ImageIcon, key: 'image', labelKey: 'chips.image' },
  { icon: VideoIcon, key: 'video', labelKey: 'chips.video' },
];

/**
 * Suggested-prompt chips shown under the chat overlay. Multimodal: a text
 * prompt (fills + sends through the chat editor) plus image/video examples
 * that route to the respective generation flow. Pill-styled with leading
 * icons; readable in light + dark via theme tokens.
 */
const HomeChips = memo(() => {
  const { t } = useTranslation('home');
  const { styles } = useStyles();
  const navigate = useHomeStore((s) => s.navigate);
  const { send } = useSend();

  const handle = async (kind: ChipKind, label: string) => {
    if (kind === 'image') {
      navigate?.('/image');
      return;
    }
    if (kind === 'video') {
      navigate?.('/video');
      return;
    }
    // text → prefill the chat editor and fire immediately.
    const editor = useChatStore.getState().mainInputEditor;
    editor?.instance?.setDocument('markdown', label);
    useChatStore.setState({ inputMessage: label });
    editor?.focus();
    await send();
  };

  return (
    <div className={styles.row}>
      {CHIPS.map(({ icon: Icon, key, labelKey }) => {
        const label = t(labelKey);
        return (
          <button
            className={styles.chip}
            key={key}
            type="button"
            onClick={() => handle(key, label)}
          >
            <Icon className={styles.icon} size={15} strokeWidth={1.9} />
            {label}
          </button>
        );
      })}
    </div>
  );
});

HomeChips.displayName = 'HomeChips';

export default HomeChips;
