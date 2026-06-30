'use client';

import { Block, Flexbox } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import {
  BotIcon,
  ImageIcon,
  type LucideIcon,
  MessageSquareIcon,
  PenLineIcon,
  VideoIcon,
} from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { useHomeStore } from '@/store/home';

const useStyles = createStyles(({ css, token }) => ({
  card: css`
    cursor: pointer;

    width: 100%;
    height: 100%;
    border: 1px solid ${token.colorBorderSecondary};

    transition:
      transform 0.18s ease,
      border-color 0.18s ease,
      background 0.18s ease,
      box-shadow 0.18s ease;

    &:hover {
      transform: translateY(-2px);
      border-color: ${token.colorPrimaryBorderHover};
      background: ${token.colorFillTertiary};
      box-shadow: 0 8px 20px rgb(0 0 0 / 6%);
    }
  `,
  desc: css`
    margin: 0;
    font-size: 12px;
    line-height: 1.3;
    color: ${token.colorTextSecondary};
  `,
  iconWrap: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 38px;
    height: 38px;
    border-radius: 10px;

    color: ${token.colorPrimary};

    background: ${token.colorPrimaryBg};
  `,
  title: css`
    font-size: 14px;
    font-weight: 600;
    line-height: 1.2;
    color: ${token.colorText};
  `,
}));

type ActionKey = 'chat' | 'image' | 'video' | 'write' | 'agent';

interface ActionItem {
  descKey: string;
  icon: LucideIcon;
  key: ActionKey;
  labelKey: string;
}

const ITEMS: ActionItem[] = [
  {
    descKey: 'quickActions.chatDesc',
    icon: MessageSquareIcon,
    key: 'chat',
    labelKey: 'quickActions.chat',
  },
  {
    descKey: 'quickActions.imageDesc',
    icon: ImageIcon,
    key: 'image',
    labelKey: 'quickActions.image',
  },
  {
    descKey: 'quickActions.videoDesc',
    icon: VideoIcon,
    key: 'video',
    labelKey: 'quickActions.video',
  },
  {
    descKey: 'quickActions.writeDesc',
    icon: PenLineIcon,
    key: 'write',
    labelKey: 'quickActions.write',
  },
  {
    descKey: 'quickActions.agentDesc',
    icon: BotIcon,
    key: 'agent',
    labelKey: 'quickActions.agent',
  },
];

/**
 * Reveal + focus the bottom-overlay chat input. The InputArea is rendered as
 * a fixed overlay anchored to the viewport bottom (see InputArea), so there is
 * nothing to "show" — we scroll it into view (no-op if already visible) and
 * focus the editor. The editor instance can be null on a cold mount, so we
 * retry a few animation frames before giving up gracefully.
 */
const focusChatInput = (attempt = 0) => {
  const editor = useChatStore.getState().mainInputEditor;
  const container = document.querySelector<HTMLElement>('[data-home-input-area]');
  container?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  if (editor) {
    editor.focus();
    return;
  }
  // Editor not mounted yet — retry up to ~10 frames (~160ms).
  if (attempt < 10) {
    requestAnimationFrame(() => focusChatInput(attempt + 1));
  }
};

/**
 * Row of 5 quick-action cards. Pure navigation surface — renders for both
 * Light and Pro UI modes so the free cohort can reach image/video flows.
 *
 * Routing:
 *   chat   → reveal + focus the bottom-overlay chat input (home surface)
 *   image  → /image
 *   video  → /video
 *   write  → inline StarterMode 'write' (long-form sendAsWrite)
 *   agent  → inline StarterMode 'agent'
 */
const QuickActions = memo(() => {
  const { t } = useTranslation('home');
  const { styles } = useStyles();
  const navigate = useHomeStore((s) => s.navigate);
  const setInputActiveMode = useHomeStore((s) => s.setInputActiveMode);

  const handleClick = useCallback(
    (key: ActionKey) => {
      switch (key) {
        case 'chat': {
          focusChatInput();
          break;
        }
        case 'image': {
          navigate?.('/image');
          break;
        }
        case 'video': {
          navigate?.('/video');
          break;
        }
        case 'write':
        case 'agent': {
          setInputActiveMode(key);
          // After switching into a starter mode the input is revealed/focused
          // by InputArea's own effect; still scroll the overlay into view.
          focusChatInput();
          break;
        }
      }
    },
    [navigate, setInputActiveMode],
  );

  const items = useMemo(() => ITEMS, []);

  return (
    <Flexbox horizontal gap={12} style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Block
            className={styles.card}
            key={item.key}
            padding={0}
            style={{ flex: '1 1 180px', maxWidth: 240, minWidth: 160 }}
            variant="outlined"
            onClick={() => handleClick(item.key)}
          >
            <Flexbox horizontal align="center" gap={12} paddingBlock={14} paddingInline={14}>
              <span className={styles.iconWrap}>
                <Icon size={20} strokeWidth={1.9} />
              </span>
              <Flexbox gap={2} style={{ minWidth: 0 }}>
                <span className={styles.title}>{t(item.labelKey)}</span>
                <p className={styles.desc}>{t(item.descKey)}</p>
              </Flexbox>
            </Flexbox>
          </Block>
        );
      })}
    </Flexbox>
  );
});

QuickActions.displayName = 'QuickActions';

export default QuickActions;
