'use client';

import { createStyles } from 'antd-style';
import { type FC, type PropsWithChildren } from 'react';

/**
 * Mobile app shell — replaces the position-fixed overlay TabBar
 * pattern with a proper flex column. See
 * docs/superpowers/specs/2026-06-01-mobile-shell-design.md.
 *
 * Structure expected at the call site:
 *   <MobileShell>
 *     <Drawer .../>                       { overlay, antd portal }
 *     <MobileShell.ScrollArea>
 *       { page content }
 *     </MobileShell.ScrollArea>
 *     <MobileTabBar />                    { flex-shrink: 0 }
 *   </MobileShell>
 *
 * The shell owns the viewport: 100dvh column, body never scrolls
 * (overflow: hidden), the ScrollArea is the only scrollable surface.
 */
const useStyles = createStyles(({ css }) => ({
  shell: css`
    /* Body does not scroll; only ScrollArea does. Without this,
       on iOS Safari you get both body scroll and inner scroll
       fighting each other when the URL bar shows/hides. */
    overflow: hidden;
    display: flex;
    flex-direction: column;

    width: 100%;

    /* Subtract any top-level chrome (CloudBanner is the only one
       today, 41px) from the shell so the bar lands ON the viewport
       bottom, not 41px below it. The caller sets
       --mobile-shell-banner-offset on .ant-app whenever such chrome
       is rendered above us; fallback 0px when nothing is. */
    height: calc(100dvh - var(--mobile-shell-banner-offset, 0px));
  `,
  scrollArea: css`
    overflow: hidden auto;

    /* Prevent rubber-band chains from propagating to the body /
       parent. Mobile Safari and Chrome both honor this. */
    overscroll-behavior: contain;

    /* Canonical flex-1 scroll child recipe:
       - flex: 1     — take all remaining height
       - min-height: 0 — allow shrinking below content height
                         (without this the child grows infinitely
                         and the bar disappears off-screen)
       - overflow-y: auto — own its scrollbar
    */
    flex: 1;

    min-height: 0;
  `,
}));

const Shell: FC<PropsWithChildren> = ({ children }) => {
  const { styles } = useStyles();
  return (
    <div className={styles.shell} data-testid="mobile-shell">
      {children}
    </div>
  );
};

const ScrollArea: FC<PropsWithChildren> = ({ children }) => {
  const { styles } = useStyles();
  return (
    <main className={styles.scrollArea} data-testid="mobile-shell-scroll-area">
      {children}
    </main>
  );
};

export const MobileShell = Object.assign(Shell, { ScrollArea });
