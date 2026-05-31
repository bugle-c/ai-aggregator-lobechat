import { Icon } from '@lobehub/ui';
import { type TabBarProps } from '@lobehub/ui/mobile';
import { TabBar } from '@lobehub/ui/mobile';
import { createStaticStyles, cssVar } from 'antd-style';
import { Gem, ImageIcon, MessageSquare, User, Video } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useShowTabBar } from '@/features/MobileGlobalHeader/useShowTabBar';
import { usePathname, useRouter } from '@/libs/router/navigation';
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

  // SSR-safe portal target. We MUST render the tab bar as a direct
  // child of document.body (not the regular React tree) because antd
  // Drawer applies `filter: blur(3px)` to the background container
  // when open. CSS spec: `filter` (and `transform`, `will-change:
  // transform`, `perspective`, `contain: paint/strict/layout`) creates
  // a NEW containing block for `position: fixed` descendants — so a
  // tab bar nested inside the blurred subtree gets anchored to that
  // blurred wrapper instead of the viewport. With CloudBanner on top
  // (41px high), the tab bar ends up 41px below the viewport edge,
  // invisible. When the Drawer opens/closes, the blur transitions in
  // 0.2s and the tab bar visibly jumps. Portaling to body sidesteps
  // every ancestor-induced containing block: it stays viewport-fixed
  // regardless of what Drawer, transform, or filter rules upstream
  // ever do. See https://drafts.csswg.org/css-transforms-1/#containing-block-fixpos
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Hide on chat threads (`/chat/[topicId]`) so messages have full
  // vertical space. Visible everywhere else, including settings sub-pages.
  if (!visible || !mounted) return null;

  // Pin to viewport bottom as an overlay so it doesn't shrink the
  // content area. Pages that need to avoid hiding the last bit of
  // content under the bar should add `paddingBlockEnd` accordingly
  // (~72px = 56px bar + 16px safe gap).
  return createPortal(
    <div
      style={{
        backgroundColor: 'var(--ant-color-bg-container)',
        borderBlockStart: '1px solid var(--ant-color-border-secondary)',
        bottom: 0,
        // Promote to its own compositing layer — paint stays stable
        // during background reflow (URL bar show/hide on iOS Safari).
        contain: 'layout style paint',
        insetInline: 0,
        position: 'fixed',
        transform: 'translateZ(0)',
        willChange: 'transform',
        zIndex: 50,
      }}
    >
      <TabBar safeArea activeKey={activeKey} className={className} items={items} />
    </div>,
    document.body,
  );
});
