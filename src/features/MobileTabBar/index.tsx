import { Icon } from '@lobehub/ui';
import { type TabBarProps } from '@lobehub/ui/mobile';
import { TabBar } from '@lobehub/ui/mobile';
import { createStaticStyles, cssVar, useTheme } from 'antd-style';
import { Gem, ImageIcon, MessageSquare, User, Video } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useShowTabBar } from '@/features/MobileGlobalHeader/useShowTabBar';
import { usePathname, useRouter } from '@/libs/router/navigation';
import { SidebarTabKey } from '@/store/global/initialState';

// Height of the icon row inside the bar (does NOT include safe-area
// inset padding that the wrapper adds separately). Exported so other
// surfaces can position themselves above the bar without hardcoding 56.
export const MOBILE_TAB_BAR_HEIGHT = 56;

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
  const pathname = usePathname() ?? '/';

  // Derive the active tab from the URL — the parent prop `tabBarKey` is
  // a `SidebarTabKey` enum that doesn't include the literal `'plans'`
  // we use for the subscription tab, so highlighting based on prop
  // alone never lit up the Plans icon. Falling back to pathname keeps
  // the existing prop-driven highlight for the other tabs working.
  const activeKey: string | undefined = useMemo(() => {
    if (pathname.startsWith('/settings/plans')) return 'plans';
    if (pathname.startsWith('/settings')) return SidebarTabKey.Setting;
    if (pathname.startsWith('/image')) return SidebarTabKey.Image;
    if (pathname.startsWith('/video')) return SidebarTabKey.Video;
    if (pathname === '/' || pathname.startsWith('/chat')) return SidebarTabKey.Chat;
    return tabBarKey;
  }, [pathname, tabBarKey]);

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
          router.push('/settings/plans');
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

  // The bar is now a regular flex child of MobileShell — no portal,
  // no `position: fixed`, no `transform`/`will-change`/`contain`
  // tricks. CSS variables resolve normally because we live inside
  // .ant-app, and the visual style uses antd-style's useTheme() so
  // colors are real hex strings (no var() resolution race
  // conditions).
  const theme = useTheme();

  // Hide on chat threads (/agent/<id>, /group/<id>, /chat/<id>)
  // so messages get full vertical space; visible everywhere else.
  if (!visible) return null;

  return (
    <div
      data-testid="mobile-tabbar"
      style={{
        backgroundColor: theme.colorBgContainer,
        borderBlockStart: `1px solid ${theme.colorBorderSecondary}`,
        // Elevation that adapts to theme. In light mode the spec's
        // 0 -2px 12px rgba(0,0,0,0.08) lifts the bar; in dark mode
        // the same RGBA shadow is invisible (black-on-near-black),
        // so we use the antd token `boxShadowSecondary` which is
        // pre-tuned per theme. Falls back to a hardcoded value only
        // if the token is missing (very old antd, shouldn't happen).
        boxShadow: theme.boxShadowSecondary || '0 -2px 12px rgba(0, 0, 0, 0.08)',
        // iOS notch / home-indicator safe area. Padding is on the
        // wrapper (not the inner <TabBar>) so the background color
        // extends all the way to the bottom edge of the screen.
        paddingBlockEnd: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <TabBar
        activeKey={activeKey}
        className={className}
        items={items}
        // Wrapper provides the safe-area inset; lobehub's safeArea
        // mode would put a transparent strip inside <TabBar>, which
        // would show whatever's behind it if we ever had a Drawer
        // sliding under the bar.
      />
    </div>
  );
});
