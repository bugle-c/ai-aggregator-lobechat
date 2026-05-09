import { Icon } from '@lobehub/ui';
import { type TabBarProps } from '@lobehub/ui/mobile';
import { TabBar } from '@lobehub/ui/mobile';
import { createStaticStyles, cssVar } from 'antd-style';
import { Gem, ImageIcon, MessageSquare, User, Video } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useShowTabBar } from '@/features/MobileGlobalHeader/useShowTabBar';
import { useRouter } from '@/libs/router/navigation';
import { SidebarTabKey } from '@/store/global/initialState';

const styles = createStaticStyles(({ css }) => ({
  active: css`
    svg {
      fill: color-mix(in srgb, ${cssVar.colorPrimary} 25%, transparent);
    }
  `,
}));

interface Props {
  className?: string;
  tabBarKey?: SidebarTabKey;
}

export default memo<Props>(({ className, tabBarKey }) => {
  const visible = useShowTabBar();
  const { t } = useTranslation('common');
  const { t: tSub } = useTranslation('subscription');
  const router = useRouter();

  // Mobile tab bar is intentionally minimal — exactly 5 items regardless
  // of Light/Pro mode (per spec Q5: kill UIMode-driven mobile branching).
  // Сообщество, Agent-builder etc. are power-user surfaces unsuited to
  // a phone screen; they remain reachable from the desktop sidebar.
  // Settings tab always lands on /settings — that route renders the
  // mobile list-of-links (MobileSettingsList) on small screens, so the
  // user gets a back-able overview instead of being dumped into provider
  // config.
  const items: TabBarProps['items'] = useMemo(
    () => [
      {
        icon: (active: boolean) => (
          <Icon className={active ? styles.active : undefined} icon={MessageSquare} />
        ),
        key: SidebarTabKey.Chat,
        onClick: () => {
          router.push('/');
        },
        title: t('tab.chat'),
      },
      {
        icon: (active: boolean) => (
          <Icon className={active ? styles.active : undefined} icon={ImageIcon} />
        ),
        key: SidebarTabKey.Image,
        onClick: () => {
          router.push('/image');
        },
        title: t('tab.aiImage'),
      },
      {
        icon: (active: boolean) => (
          <Icon className={active ? styles.active : undefined} icon={Video} />
        ),
        key: SidebarTabKey.Video,
        onClick: () => {
          router.push('/video');
        },
        title: t('tab.video'),
      },
      {
        icon: (active: boolean) => (
          <Icon className={active ? styles.active : undefined} icon={Gem} />
        ),
        key: 'plans' as SidebarTabKey,
        onClick: () => {
          router.push('/settings/subscription/plans');
        },
        title: tSub('sidebar.plans'),
      },
      {
        icon: (active: boolean) => (
          <Icon className={active ? styles.active : undefined} icon={User} />
        ),
        key: SidebarTabKey.Setting,
        onClick: () => {
          router.push('/settings');
        },
        title: t('tab.setting'),
      },
    ],
    [t, tSub, router],
  );

  // Hide on chat threads (`/chat/[topicId]`) so messages have full
  // vertical space. Visible everywhere else, including settings sub-pages.
  if (!visible) return null;

  // Pin to viewport bottom as an overlay so it doesn't shrink the
  // content area. Pages that need to avoid hiding the last bit of
  // content under the bar should add `paddingBlockEnd` accordingly
  // (~72px = 56px bar + 16px safe gap).
  return (
    <div
      style={{
        backgroundColor: 'var(--ant-color-bg-container)',
        borderBlockStart: '1px solid var(--ant-color-border-secondary)',
        bottom: 0,
        insetInline: 0,
        position: 'fixed',
        zIndex: 50,
      }}
    >
      <TabBar safeArea activeKey={tabBarKey} className={className} items={items} />
    </div>
  );
});
