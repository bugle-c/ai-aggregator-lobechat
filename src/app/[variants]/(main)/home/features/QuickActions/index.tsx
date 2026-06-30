'use client';

import { Block, Center, Flexbox } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { BotIcon, ImageIcon, type LucideIcon, MessageSquareIcon, PenLineIcon, VideoIcon } from 'lucide-react';
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
      background 0.18s ease;

    &:hover {
      transform: translateY(-2px);
      border-color: ${token.colorPrimaryBorderHover};
      background: ${token.colorFillTertiary};
    }
  `,
  label: css`
    font-size: 13px;
    font-weight: 600;
  `,
}));

type ActionKey = 'chat' | 'image' | 'video' | 'write' | 'agent';

type LabelKey =
  | 'quickActions.agent'
  | 'quickActions.chat'
  | 'quickActions.image'
  | 'quickActions.video'
  | 'quickActions.write';

interface ActionItem {
  icon: LucideIcon;
  key: ActionKey;
  labelKey: LabelKey;
}

const ITEMS: ActionItem[] = [
  { icon: MessageSquareIcon, key: 'chat', labelKey: 'quickActions.chat' },
  { icon: ImageIcon, key: 'image', labelKey: 'quickActions.image' },
  { icon: VideoIcon, key: 'video', labelKey: 'quickActions.video' },
  { icon: PenLineIcon, key: 'write', labelKey: 'quickActions.write' },
  { icon: BotIcon, key: 'agent', labelKey: 'quickActions.agent' },
];

/**
 * Row of 5 quick-action cards. Pure navigation surface — renders for both
 * Light and Pro UI modes so the free cohort can reach image/video flows.
 *
 * Routing:
 *   chat   → focus the chat input (no navigation; this IS the home surface)
 *   image  → /image
 *   video  → /video
 *   write  → inline StarterMode 'write'
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
          // Focus the existing chat input below — chat is the home surface.
          requestAnimationFrame(() => {
            useChatStore.getState().mainInputEditor?.focus();
          });
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
            style={{ flex: '1 1 140px', maxWidth: 200, minWidth: 130 }}
            variant="outlined"
            onClick={() => handleClick(item.key)}
          >
            <Center gap={8} paddingBlock={16} paddingInline={12}>
              <Icon size={22} strokeWidth={1.75} />
              <span className={styles.label}>{t(item.labelKey)}</span>
            </Center>
          </Block>
        );
      })}
    </Flexbox>
  );
});

QuickActions.displayName = 'QuickActions';

export default QuickActions;
