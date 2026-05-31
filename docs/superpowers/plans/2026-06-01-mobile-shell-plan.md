# Mobile Shell Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the `position: fixed` overlay `MobileTabBar` with a proper flex-column app shell on viewports `<576px`, behind a `?mobile-shell=off` kill-switch, so the bar stops jumping (Drawer-blur containing-block trap), stops melting into the background (gets a real shadow), and stops being hidden under scrolling page content.

**Architecture:** Two-branch JSX in `_layout/index.tsx`: on mobile we render `<MobileShell>` (flex column, height `100dvh`, `overflow: hidden`) with three children — antd `<Drawer>` (overlay via its own body-portal), `<MobileShell.ScrollArea>` (the page-content area with `flex: 1` and its own scroll), and `<MobileTabBar>` (now a regular `flex-shrink: 0` child, no portal, no fixed). On desktop the layout stays exactly as today. A `useMobileShellFlag()` hook (URL query → localStorage → default `on`) gates the new branch so we can instantly fall back to the old behaviour.

**Tech Stack:** Next.js 16 + React 19 (LobeChat fork), antd-style `createStyles`/`useTheme`, `@lobehub/ui/mobile` `<TabBar>`, antd `<Drawer>`, Vitest + `@testing-library/react` + happy-dom for unit tests, Playwright via the MCP browser tool for post-deploy verification.

**Spec:** `docs/superpowers/specs/2026-06-01-mobile-shell-design.md` (commit `9d3c3eb048`).

**Reference files** (read once at the start so you understand the current shape):

- `src/features/MobileTabBar/index.tsx` — current tab bar with portal/translateZ workaround
- `src/features/TgLinkBonusBanner/MobileStickyBar.tsx` — has its own local `MOBILE_TAB_BAR_HEIGHT = 56`
- `src/app/[variants]/(main)/_layout/index.tsx` — main layout that we'll branch
- `src/layout/GlobalProvider/AppTheme.tsx` — owns `.app` with `min/max-height: 100dvh`
- `src/hooks/useIsMobile.ts` — pattern reference for our new hook
- `src/hooks/useAutoScroll.test.ts` — pattern reference for Vitest + happy-dom test

---

## Task 1: Export `MOBILE_TAB_BAR_HEIGHT` constant + dedupe

**Files:**

- Modify: `src/features/MobileTabBar/index.tsx` (add export near top, after imports)
- Modify: `src/features/TgLinkBonusBanner/MobileStickyBar.tsx:10-11` (drop local const, import from MobileTabBar)

**Step 1: Add the exported constant in MobileTabBar**

Edit `src/features/MobileTabBar/index.tsx`. Add right after the imports, before `const styles = createStaticStyles(...)`:

```ts
// Height of the icon row inside the bar (does NOT include safe-area
// inset padding that the wrapper adds separately). Exported so other
// surfaces can position themselves above the bar without hardcoding 56.
export const MOBILE_TAB_BAR_HEIGHT = 56;
```

**Step 2: Use the import in MobileStickyBar**

Edit `src/features/TgLinkBonusBanner/MobileStickyBar.tsx`. Replace lines \~10-11:

```ts
// Was:
//   // Keep in sync with src/features/MobileTabBar height.
//   const MOBILE_TAB_BAR_HEIGHT = 56;
import { MOBILE_TAB_BAR_HEIGHT } from '@/features/MobileTabBar';
```

**Step 3: Verify TypeScript still compiles**

Run: `cd /home/deploy/projects/ai-aggregator-lobechat && bunx tsc --noEmit -p tsconfig.json 2>&1 | tail -20`

Expected: no errors. (The build sometimes OOMs locally — if you see a heap allocation failure, that's environmental, not a code error; treat as PASS if no TS error lines appear before the OOM.)

**Step 4: Commit**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
git add src/features/MobileTabBar/index.tsx src/features/TgLinkBonusBanner/MobileStickyBar.tsx
git commit -m "refactor(mobile): export MOBILE_TAB_BAR_HEIGHT as single source of truth

Drop the duplicated local constant in MobileStickyBar — import from
MobileTabBar instead. No behaviour change; sets us up for the shell
refactor where the constant becomes structurally important."
```

---

## Task 2: Create `useMobileShellFlag` hook with unit tests

**Files:**

- Create: `src/hooks/useMobileShellFlag.ts`
- Create: `src/hooks/useMobileShellFlag.test.ts`

**Step 1: Write the failing test**

Create `src/hooks/useMobileShellFlag.test.ts`:

```ts
/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useMobileShellFlag } from './useMobileShellFlag';

const setUrl = (search: string) => {
  // happy-dom lets us replace location.href via assignment.
  window.history.replaceState({}, '', `/${search}`);
};

describe('useMobileShellFlag', () => {
  beforeEach(() => {
    localStorage.clear();
    setUrl('');
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('defaults to enabled when no URL param and no localStorage', () => {
    const { result } = renderHook(() => useMobileShellFlag());
    expect(result.current).toBe(true);
  });

  it('returns false when localStorage has off', () => {
    localStorage.setItem('mobile-shell-v2', 'off');
    const { result } = renderHook(() => useMobileShellFlag());
    expect(result.current).toBe(false);
  });

  it('URL ?mobile-shell=off overrides and persists to localStorage', () => {
    setUrl('?mobile-shell=off');
    const { result } = renderHook(() => useMobileShellFlag());
    expect(result.current).toBe(false);
    expect(localStorage.getItem('mobile-shell-v2')).toBe('off');
  });

  it('URL ?mobile-shell=on overrides and persists to localStorage', () => {
    localStorage.setItem('mobile-shell-v2', 'off');
    setUrl('?mobile-shell=on');
    const { result } = renderHook(() => useMobileShellFlag());
    expect(result.current).toBe(true);
    expect(localStorage.getItem('mobile-shell-v2')).toBe('on');
  });

  it('ignores garbage URL param values', () => {
    setUrl('?mobile-shell=garbage');
    localStorage.setItem('mobile-shell-v2', 'off');
    const { result } = renderHook(() => useMobileShellFlag());
    // Falls through to localStorage, which says off.
    expect(result.current).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/deploy/projects/ai-aggregator-lobechat && bun run vitest src/hooks/useMobileShellFlag.test.ts --run 2>&1 | tail -25`

Expected: FAIL — `Cannot find module './useMobileShellFlag'`.

**Step 3: Write the hook**

Create `src/hooks/useMobileShellFlag.ts`:

```ts
'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'mobile-shell-v2';

/**
 * Kill-switch for the new mobile flex-shell layout (see
 * docs/superpowers/specs/2026-06-01-mobile-shell-design.md).
 *
 * Resolution order:
 *   1. URL query `?mobile-shell=on` or `?mobile-shell=off` —
 *      highest priority, persisted to localStorage so subsequent
 *      visits keep the same choice.
 *   2. localStorage `mobile-shell-v2` — survives across sessions.
 *   3. Default `true` — new users get the new shell.
 *
 * Defaults to `true` on the server / first render to keep SSR
 * markup stable; flips to the persisted/queried value once the
 * client effect runs. If we ever start serving the desktop layout
 * to mobile crawlers we'd reconsider, but for now SSR ≠ user agent
 * targeting.
 */
export const useMobileShellFlag = (): boolean => {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    const q = params.get('mobile-shell');
    if (q === 'on' || q === 'off') {
      window.localStorage.setItem(STORAGE_KEY, q);
      setEnabled(q === 'on');
      return;
    }

    const stored = window.localStorage.getItem(STORAGE_KEY);
    // Only `'off'` disables; anything else (including null / garbage)
    // means new shell is on.
    setEnabled(stored !== 'off');
  }, []);

  return enabled;
};
```

**Step 4: Run test to verify it passes**

Run: `cd /home/deploy/projects/ai-aggregator-lobechat && bun run vitest src/hooks/useMobileShellFlag.test.ts --run 2>&1 | tail -20`

Expected: PASS — `5 passed`.

**Step 5: Commit**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
git add src/hooks/useMobileShellFlag.ts src/hooks/useMobileShellFlag.test.ts
git commit -m "feat(hooks): add useMobileShellFlag kill-switch

URL query > localStorage > default-on. Lets us toggle the new
mobile flex-shell at runtime per user, so a single broken case
can roll back by appending ?mobile-shell=off."
```

---

## Task 3: Create `MobileShell` compound component

**Files:**

- Create: `src/app/[variants]/(main)/_layout/MobileShell.tsx`

**Step 1: Write the component**

Create the file with the full implementation:

```tsx
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
 *     <Drawer .../>                         { overlay, antd portal }
 *     <MobileShell.ScrollArea>
 *       { page content }
 *     </MobileShell.ScrollArea>
 *     <MobileTabBar />                      { flex-shrink: 0 }
 *   </MobileShell>
 *
 * The shell owns the viewport: 100dvh column, body never scrolls
 * (overflow: hidden), the ScrollArea is the only scrollable surface.
 */
const useStyles = createStyles(({ css }) => ({
  shell: css`
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100dvh;
    /* Body does not scroll; only ScrollArea does. Without this,
       on iOS Safari you get both body scroll and inner scroll
       fighting each other when the URL bar shows/hides. */
    overflow: hidden;
  `,
  scrollArea: css`
    /* Canonical flex-1 scroll child recipe:
       - flex: 1     — take all remaining height
       - min-height: 0 — allow shrinking below content height
                         (without this the child grows infinitely
                         and the bar disappears off-screen)
       - overflow-y: auto — own its scrollbar
    */
    flex: 1;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    /* Prevent rubber-band chains from propagating to the body /
       parent. Mobile Safari and Chrome both honor this. */
    overscroll-behavior: contain;
  `,
}));

const Shell: FC<PropsWithChildren> = ({ children }) => {
  const { styles } = useStyles();
  return <div className={styles.shell}>{children}</div>;
};

const ScrollArea: FC<PropsWithChildren> = ({ children }) => {
  const { styles } = useStyles();
  return <main className={styles.scrollArea}>{children}</main>;
};

export const MobileShell = Object.assign(Shell, { ScrollArea });
```

**Step 2: Verify TypeScript compiles**

Run: `cd /home/deploy/projects/ai-aggregator-lobechat && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep "MobileShell\." | head -10`

Expected: no errors mentioning MobileShell. (See Task 1 Step 3 about OOM.)

**Step 3: Commit**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
git add src/app/\[variants\]/\(main\)/_layout/MobileShell.tsx
git commit -m "feat(mobile): add MobileShell compound component

Flex column wrapper that owns mobile viewport: height: 100dvh,
body locked (overflow: hidden), ScrollArea takes flex:1 with
its own scroll. Tab bar will be the third flex child, no longer
a fixed overlay. Not wired yet — see next commit."
```

---

## Task 4: Simplify `MobileTabBar` — flex child, real shadow, no portal

**Files:**

- Modify: `src/features/MobileTabBar/index.tsx`

**Step 1: Read current state**

Run: `cat /home/deploy/projects/ai-aggregator-lobechat/src/features/MobileTabBar/index.tsx`

You'll see imports of `createPortal`, `useEffect`, `useState`, and a long comment about portal target. All going away.

**Step 2: Rewrite imports and the render block**

Edit `src/features/MobileTabBar/index.tsx`:

- Drop these imports:
  - `createPortal` from `react-dom`
  - `useEffect`, `useState` from `react` (keep `memo` and `useMemo`)
- Add this import:
  - `import { useTheme } from 'antd-style';`

Replace the entire post-`items` block (everything from `// SSR-safe portal target.` comment through the final `});`) with:

```tsx
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
      style={{
        backgroundColor: theme.colorBgContainer,
        borderBlockStart: `1px solid ${theme.colorBorderSecondary}`,
        // Material-style elevation. Inverted Y because the bar
        // sits at the bottom: light "lifts" it off the page.
        boxShadow: '0 -2px 12px rgba(0, 0, 0, 0.08)',
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
```

**Step 3: Verify the final file**

Run: `head -20 /home/deploy/projects/ai-aggregator-lobechat/src/features/MobileTabBar/index.tsx && echo --- && tail -30 /home/deploy/projects/ai-aggregator-lobechat/src/features/MobileTabBar/index.tsx`

Imports should NOT contain `createPortal` or `useState`/`useEffect`. Tail should be the new render block + closing `});`.

**Step 4: TypeScript check**

Run: `cd /home/deploy/projects/ai-aggregator-lobechat && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep "MobileTabBar" | head -10`

Expected: no errors.

**Step 5: Commit (do NOT push yet — Task 5 + 6 join this commit logically)**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
git add src/features/MobileTabBar/index.tsx
git commit -m "refactor(mobile/tabbar): drop portal, use useTheme, add elevation

Strip everything the bar needed when it lived outside the React tree
of its page (createPortal, position:fixed, translateZ, contain). With
MobileShell taking over layout responsibility next commit, the bar is
just a flex-shrink child that paints with antd theme tokens (no CSS
var() resolution drama) and gets a Material-style box-shadow so it
visually separates from the content above."
```

---

## Task 5: Branch `_layout/index.tsx` on `isMobile && isMobileShellEnabled`

**Files:**

- Modify: `src/app/[variants]/(main)/_layout/index.tsx`

**Step 1: Read current state**

Run: `cat /home/deploy/projects/ai-aggregator-lobechat/src/app/\[variants\]/\(main\)/_layout/index.tsx`

You'll see the layout currently renders one JSX tree with `{isMobile && <Drawer/>}` and `{isMobile && <MobileTabBar/>}` sprinkled inside. We'll split into a clean ternary.

**Step 2: Add imports**

Top of file, add:

```ts
import { MobileShell } from './MobileShell';
import { useMobileShellFlag } from '@/hooks/useMobileShellFlag';
```

Existing `MobileTabBar` import stays.

**Step 3: Call the hook inside the Layout component**

Inside `const Layout: FC = () => { ... }`, after the existing hook calls (around the `useFeedbackModal` line), add:

```ts
const isMobileShellEnabled = useMobileShellFlag();
```

**Step 4: Rewrite the return statement**

Replace the return block. Keep `<HotkeysProvider>` and the shared `<Suspense>` blocks at the top/bottom, but split the middle into a ternary. Resulting return:

```tsx
return (
  <HotkeysProvider initiallyActiveScopes={[HotkeyScopeEnum.Global]}>
    <Suspense fallback={null}>
      {isDesktop && <DesktopAutoOidcOnFirstOpen />}
      {isDesktop && <DesktopNavigationBridge />}
      {isDesktop && <DesktopFileMenuBridge />}
      {isDesktop && <AuthRequiredModal />}
      {showCloudPromotion && <CloudBanner />}
    </Suspense>

    <Suspense fallback={null}>{isDesktop && <TitleBar />}</Suspense>

    {isMobile && isMobileShellEnabled ? (
      <MobileShell>
        <Drawer
          destroyOnHidden={false}
          open={showLeftPanel}
          placement="left"
          styles={{ body: { padding: 0 } }}
          title={null}
          width={300}
          onClose={() => toggleLeftPanel(false)}
        >
          <NavPanel />
        </Drawer>
        <MobileShell.ScrollArea>
          <DndContextWrapper>
            <MarketAuthProvider isDesktop={isDesktop}>
              <DesktopHomeLayout>
                <DesktopHome />
              </DesktopHomeLayout>
              <Suspense fallback={<Loading debugId="MobileShell > Outlet" />}>
                <Outlet />
              </Suspense>
            </MarketAuthProvider>
          </DndContextWrapper>
        </MobileShell.ScrollArea>
        <MobileTabBar />
      </MobileShell>
    ) : (
      <DndContextWrapper>
        <Flexbox
          horizontal
          className={cx(isPWA ? styles.mainContainerPWA : styles.mainContainer)}
          width={'100%'}
          height={
            isDesktop
              ? `calc(100% - ${TITLE_BAR_HEIGHT}px)`
              : showCloudPromotion
                ? `calc(100% - ${BANNER_HEIGHT}px)`
                : '100%'
          }
        >
          {!isMobile && <NavPanel />}
          {isMobile && (
            <Drawer
              destroyOnHidden={false}
              open={showLeftPanel}
              placement="left"
              styles={{ body: { padding: 0 } }}
              title={null}
              width={300}
              onClose={() => toggleLeftPanel(false)}
            >
              <NavPanel />
            </Drawer>
          )}
          <DesktopLayoutContainer>
            <MarketAuthProvider isDesktop={isDesktop}>
              <DesktopHomeLayout>
                <DesktopHome />
              </DesktopHomeLayout>
              <Suspense fallback={<Loading debugId="DesktopMainLayout > Outlet" />}>
                <Outlet />
              </Suspense>
            </MarketAuthProvider>
          </DesktopLayoutContainer>
        </Flexbox>
        {isMobile && !isMobileShellEnabled && <MobileTabBar />}
      </DndContextWrapper>
    )}

    <Suspense fallback={null}>
      <HotkeyHelperPanel />
      <RegisterHotkeys />
      <CmdkLazy />
      <RetryModal />
      <TgLinkBonusGlobal />
      {isFeedbackModalOpen && (
        <Suspense fallback={null}>
          <FeedbackModal
            initialValues={feedbackInitialValues}
            open={isFeedbackModalOpen}
            onClose={closeFeedbackModal}
          />
        </Suspense>
      )}
    </Suspense>
  </HotkeysProvider>
);
```

Note the fallback branch: when the flag is **off** and the user is on mobile, the OLD `<MobileTabBar/>` rendering (after the closing `</Flexbox>` inside `<DndContextWrapper>`) is preserved as it was — the bar in its old portal-overlay shape — so the kill-switch is truly a kill-switch back to today's behaviour.

**Step 5: TypeScript check**

Run: `cd /home/deploy/projects/ai-aggregator-lobechat && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep "_layout\|MobileShell\|useMobileShellFlag" | head -10`

Expected: no errors. (See Task 1 Step 3 about OOM.)

**Step 6: Commit**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
git add src/app/\[variants\]/\(main\)/_layout/index.tsx
git commit -m "feat(mobile): branch _layout into MobileShell vs legacy

When isMobile && isMobileShellEnabled, render the new flex column
shell with three children (Drawer, ScrollArea, MobileTabBar). When
the flag is off, fall back to the existing layout exactly — the
DndContextWrapper > Flexbox > DesktopLayoutContainer tree with the
overlay-mode MobileTabBar at the end. Lets a user with ?mobile-shell=off
get back to today's behavior with no other changes."
```

---

## Task 6: Release `.app` from `100dvh` constraint on mobile

**Files:**

- Modify: `src/layout/GlobalProvider/AppTheme.tsx`

**Step 1: Read current `.app` styles**

Run: `grep -A 15 "app: css\`" /home/deploy/projects/ai-aggregator-lobechat/src/layout/GlobalProvider/AppTheme.tsx | head -25\`

You'll see the block ending around line 45 with `@media (device-width >= 576px) { overflow: hidden; }`.

**Step 2: Add the `<576px` block**

Edit the file. Inside the existing `app: css\`...\``template literal, after the existing`@media (device-width >= 576px) { overflow: hidden; }\` rule, append a new block:

```css
@media (max-width: 575px) {
  /* MobileShell owns mobile viewport now (height: 100dvh on
         the shell itself). Releasing .app from its own 100dvh
         constraint prevents a nested-100dvh fight where the shell
         can't shrink below .app's height. */
  min-height: 0;
  max-height: none;
  overflow: visible;
}
```

**Step 3: TypeScript / styles check**

This is plain CSS-in-JS inside a template literal — types unaffected. Just confirm the file parses by running a project-wide check:

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
bunx tsc --noEmit -p tsconfig.json 2>&1 | grep "AppTheme" | head -5
```

Expected: no lines (no errors). (See Task 1 Step 3 about OOM behaviour.)

**Step 4: Commit + push the whole chain**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
git add src/layout/GlobalProvider/AppTheme.tsx
git commit -m "fix(theme): release .app from 100dvh on mobile

MobileShell takes 100dvh itself; .app keeping the same lock
means two siblings fighting for the same height and the shell
can't shrink to give the tab bar real flex space. Adds a
<576px media query that drops min/max-height and lets overflow
be visible — desktop unchanged."
git push origin canary
```

After push, Hetzner GHA builds and recreates `lobehub` container in \~3 minutes.

---

## Task 7: Post-deploy verification

This is a verification task, not a code task. Use the Playwright MCP browser tool.

**Step 1: Wait for deploy + force recreate if needed**

Run: `ssh deploy@135.181.115.234 "docker image inspect lobechat-custom:latest --format 'Image: {{.Created}}'; docker inspect lobehub --format 'Container: {{.State.StartedAt}}'"`

If image is newer than container, run: `ssh deploy@135.181.115.234 "cd /opt/lobechat && docker compose up -d --force-recreate lobe"`.

**Step 2: T1 — position correct**

Open `https://ask.gptweb.ru/settings/plans` in the browser tool at viewport 390×844. Evaluate:

```js
() => {
  const wrapper = Array.from(document.querySelectorAll('div, footer')).find((el) => {
    const fs = el.tagName === 'FOOTER' ? el : el.querySelector('footer');
    return fs && getComputedStyle(el.parentElement || el).display === 'flex';
  });
  // Locate the bar wrapper (parent of the inner <footer>) by finding
  // the flex column shell and taking its last child.
  const shell = document.querySelector('main')?.parentElement;
  const tabbar = shell?.lastElementChild;
  const rect = tabbar?.getBoundingClientRect();
  return {
    viewport: window.innerHeight,
    tabbarTop: rect?.top,
    tabbarBottom: rect?.bottom,
    tabbarHeight: rect?.height,
    bg: tabbar ? getComputedStyle(tabbar).backgroundColor : null,
    shadow: tabbar ? getComputedStyle(tabbar).boxShadow : null,
    parentTag: tabbar?.parentElement?.tagName,
    parentStyle: tabbar?.parentElement ? getComputedStyle(tabbar.parentElement).display : null,
  };
};
```

Expected: `tabbarBottom === viewport (844)`, `tabbarHeight >= 56` (icon row + safe-area; could be \~56 on a viewport without notch), `bg !== 'rgba(0, 0, 0, 0)'`, `shadow` starts with `rgba` and contains `-2px`, `parentStyle === 'flex'`.

**Step 3: T2 — content does not slide under tab bar**

On the same page, evaluate:

```js
async () => {
  const scrollArea = document.querySelector('main');
  if (!scrollArea) return { error: 'no main' };
  scrollArea.scrollTo({ top: scrollArea.scrollHeight, behavior: 'instant' });
  await new Promise((r) => setTimeout(r, 300));
  const lastCard = scrollArea.querySelectorAll('.ant-card');
  const last = lastCard[lastCard.length - 1];
  const lastRect = last?.getBoundingClientRect();
  const tabbar = scrollArea.parentElement.lastElementChild;
  const tabbarRect = tabbar.getBoundingClientRect();
  return {
    lastCardBottom: lastRect?.bottom,
    tabbarTop: tabbarRect.top,
    overlap: lastRect ? lastRect.bottom > tabbarRect.top : 'no card',
  };
};
```

Expected: `overlap === false` (the last card sits above the tab bar).

**Step 4: T3 — Drawer interaction**

Programmatically open Drawer (or open via burger if you can find the trigger). Re-measure tabbarTop; should be unchanged.

```js
() => {
  // Toggle the global drawer via the store; quickest path is to
  // simulate the burger click if there is one. If you can't find
  // it from the snapshot, skip and verify visually after Step 5.
  return { note: 'verify visually that drawer open/close does not move tabbar' };
};
```

**Step 5: T4 — kill-switch works**

Navigate to `https://ask.gptweb.ru/settings/plans?mobile-shell=off`. Wait \~1s for the `useEffect` to write localStorage and re-render. Re-run Step 2's evaluation.

Expected: now `parentStyle !== 'flex'` (the bar is back in overlay/fixed mode), `localStorage.getItem('mobile-shell-v2') === 'off'`.

Then navigate to `?mobile-shell=on` — bar should be flex-mode again, localStorage flips to `'on'`.

**Step 6: T5 — desktop intact**

Resize viewport to `1280×800`, navigate to `/settings/plans`. Confirm: `NavPanel` rendered on the left, no `<main>` from MobileShell, layout looks like current desktop.

**Step 7: Report findings**

Write a short summary to the user with:

- ✅/❌ for each of T1–T5
- Any unexpected console errors
- Screenshot of mobile view at 390×844 (use `browser_take_screenshot`)
- Whether kill-switch works

If everything passes, ask user to test on real phone (manual checks U7, X2, X5, X6, X9 from the spec's risk register).

---

## Task 8: Smoke-fix reserve (only if Task 7 finds issues)

This task only runs if Task 7 surfaces a regression. Common fix patterns from the spec's risk register:

**If IntersectionObserver lazy-load is broken (C5):**

1. Find observers: `grep -rn "new IntersectionObserver\|useInView" src/ | grep -v ".test."`
2. Pass `root: scrollAreaRef.current` where they use `root: null` and live inside the mobile shell.

**If MobileFlowFAB ends up below the tab bar (U4):**

Edit `src/features/Generators/MobileFlowFAB.tsx`. Change `bottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)'` to `bottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px + 56px)'` — the FAB now sits above the in-layout tab bar instead of the old overlay.

**If Android virtual keyboard pushes input under itself (U7/X2):**

Add a hook inside `MobileShell`:

```ts
useEffect(() => {
  if (!('visualViewport' in window)) return;
  const vv = window.visualViewport;
  const handler = () => {
    document.documentElement.style.setProperty('--mobile-shell-h', `${vv.height}px`);
  };
  vv.addEventListener('resize', handler);
  handler();
  return () => vv.removeEventListener('resize', handler);
}, []);
```

And switch the shell from `height: 100dvh` to `height: var(--mobile-shell-h, 100dvh)`.

**If kill-switch fallback breaks** (the `!isMobileShellEnabled` branch doesn't match the legacy layout exactly):

Revert any incidental change to that branch in Task 5. The fallback must remain byte-identical to today's behaviour.

Each fix lands as its own commit with a focused message.

---

## After all tasks pass

1. Update `KNOWLEDGE.md` at the repo root with a one-liner:

   ```
   - Mobile layout uses MobileShell (flex column app shell), not overlay tab bar.
     Kill-switch: ?mobile-shell=off. Spec: docs/superpowers/specs/2026-06-01-mobile-shell-design.md.
   ```

2. Wait ≥48h of production use without `?mobile-shell=off` complaints.

3. Then a fifth commit removes the flag and the legacy fallback branch — but ONLY after the wait period. Don't include in this plan; track as a follow-up task.
