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

  // SSR-safe portal target. We MUST render the tab bar OUTSIDE the
  // antd Drawer's blur wrapper because Drawer applies `filter: blur(3px)`
  // to the background container when open. CSS spec: `filter` (and
  // `transform`, `will-change: transform`, `perspective`, `contain:
  // paint/strict/layout`) creates a NEW containing block for
  // `position: fixed` descendants — so a tab bar nested inside the
  // blurred subtree gets anchored to that blurred wrapper instead of
  // the viewport. With CloudBanner on top (41px high), the tab bar
  // ends up 41px below the viewport edge, invisible. When the Drawer
  // opens/closes, the blur transitions in 0.2s and the tab bar visibly
  // jumps. We target `.ant-app` (NOT document.body) because:
  //   1. `.ant-app` is the parent of the blur subtree — portaling here
  //      makes us a sibling of the blur wrapper, escaping its
  //      containing block.
  //   2. `.ant-app` is the antd CSS-in-JS theme scope. CSS vars like
  //      `--ant-color-bg-container` are declared inside it, so portaling
  //      to body would resolve those vars to `transparent` and the bar
  //      would visually melt into the page.
  // Fallback to body if .ant-app isn't mounted yet (very early render);
  // background colors are hard-coded so this fallback still looks right.
  // See https://drafts.csswg.org/css-transforms-1/#containing-block-fixpos
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPortalTarget(document.querySelector('.ant-app') ?? document.body);
  }, []);

  // Hide on chat threads (`/chat/[topicId]`) so messages have full
  // vertical space. Visible everywhere else, including settings sub-pages.
  if (!visible || !portalTarget) return null;

  // Pin to viewport bottom as an overlay so it doesn't shrink the
  // content area. Pages that need to avoid hiding the last bit of
  // content under the bar should add `paddingBlockEnd` accordingly
  // (~72px = 56px bar + 16px safe gap).
  return createPortal(
    <div
      style={{
        // Use the antd CSS var with a hard-coded fallback so the bar
        // never melts into the page even if the var fails to resolve
        // (e.g., portaled outside theme scope during a partial mount).
        backgroundColor: 'var(--ant-color-bg-container, #fff)',
        borderBlockStart: '1px solid var(--ant-color-border-secondary, rgba(0, 0, 0, 0.06))',
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
    portalTarget,
  );
});
