# Mobile shell — design

**Status:** approved 2026-06-01
**Scope:** Replace the floating-overlay `MobileTabBar` with a true
flex-grid app shell on small viewports (`<576px`). The tab bar
becomes a flex-shrink child instead of `position: fixed`; the page
content lives in a dedicated scroll area between the header and the
bar. Goal is to make the bottom navigation behave like a native bottom
nav: it doesn't jump, it doesn't melt into the page, and content can't
slide under it.
**Out of scope:** desktop layout (unchanged); chat-thread layout
(`useShowTabBar` already hides the bar there — shell still applies);
visual redesign of icons or labels; new badges or animations on tab
items.

## Why now

Three bugs in three days, all rooted in the same architectural mistake.
The bar is a `position: fixed` overlay that lives inside the React tree
of the page it overlays. CSS spec: any ancestor that adds `transform`,
`filter`, `perspective`, `will-change: transform`, or `contain:
paint/strict/layout` creates a new containing block for fixed
descendants — so the bar gets reanchored to that ancestor instead of
the viewport. The antd Drawer transitions `filter: blur(3px)` on its
background subtree when opened; the bar jumps 41px down (height of the
CloudBanner that pushes the blurred wrapper) for the duration of every
open/close. The page content has no `padding-block-end` reserved for
the bar, so scrollable lists run underneath it. The bar shares a
background color with the page (`var(--ant-color-bg-container)` resolves
to white in light mode, page card backgrounds also resolve to white)
and has no shadow, so it melts in visually.

We patched the symptoms three times — portal to body, portal to
`.ant-app`, composited layer hints. The root cause is the bar being an
overlay at all. Native bottom-nav patterns put the bar **in the layout
flow** and let the page-content scroll area shrink around it. We
should do the same.

## Architecture

```
.app (.ant-app)
  └─ MobileShell (display: flex; flex-direction: column; height: 100dvh; overflow: hidden)
      ├─ <Drawer/>           [antd Drawer — portal to body, overlay, unchanged]
      ├─ <main>              [flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain]
      │     └─ <DndContextWrapper/>
      │         └─ <MarketAuthProvider/>
      │             └─ <DesktopHomeLayout/> + <Outlet/>
      └─ <MobileTabBar/>     [no position:fixed, no portal — ordinary flex-shrink:0 child]
```

Desktop layout (`>=576px`) stays exactly as today — horizontal flexbox,
NavPanel inline, no tab bar. The switch happens through an `isMobile`
ternary in `_layout/index.tsx`. The two branches are entirely
independent JSX trees — no shared wrappers — so a desktop regression
can't come from mobile changes and vice versa.

The shell owns the viewport. Body never scrolls (`overflow: hidden`
on shell, body becomes static). The page-content `<main>` is the only
scroll surface on mobile, and its scrollbar is internal to that
element. iOS Safari address-bar dance still resizes `100dvh`, but the
shell reflows cleanly because every child is a flex-managed block —
the tab bar can't end up at the wrong absolute pixel because it
doesn't have an absolute pixel.

## Component changes

### `MobileTabBar/index.tsx` — full simplification

Drop `createPortal`, `useState`/`useEffect` portal-target gate,
`position: fixed`, `bottom: 0`, `insetInline: 0`, `z-index: 50`,
`transform: translateZ(0)`, `will-change: transform`, `contain:
layout style paint`, and the `var(..., fallback)` background hacks.
None of that is needed once the bar lives in the flow.

What stays:

- `useShowTabBar()` — still hides the bar on `/agent/<id>` etc.
- `activeKey` from pathname
- `items` array of 5 tabs

What's added:

```tsx
export const MOBILE_TAB_BAR_HEIGHT = 56;

const { token } = theme.useToken();

return (
  <div
    style={{
      backgroundColor: token.colorBgContainer,
      borderBlockStart: `1px solid ${token.colorBorderSecondary}`,
      // Material-style elevation: light "lifts" the bar off the page.
      // Inverted Y because the bar is at the bottom.
      boxShadow: '0 -2px 12px rgba(0, 0, 0, 0.08)',
      // iOS notch / home-indicator: background extends behind the
      // safe-area inset, icons stay above it.
      paddingBlockEnd: 'env(safe-area-inset-bottom, 0px)',
    }}
  >
    <TabBar
      activeKey={activeKey}
      items={items}
      // safeArea={false} — wrapper handles the inset so the background
      // color covers the full bottom of the screen, not just the icon row.
    />
  </div>
);
```

`theme.useToken()` resolves to real hex strings, not CSS variable
references, so the background never disappears due to portal/scope
issues regardless of where the bar gets rendered.

### `MobileShell.tsx` — new component

Compound component: `MobileShell` owns the flex column, and
`MobileShell.ScrollArea` is the `<main>` that takes `flex: 1`. The
caller in `_layout/index.tsx` composes them so the structure is
explicit at the call site.

```tsx
// src/app/[variants]/(main)/_layout/MobileShell.tsx
const useStyles = createStyles(({ css }) => ({
  shell: css`
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100dvh;
    overflow: hidden;
  `,
  scrollArea: css`
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
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

Usage:

```tsx
<MobileShell>
  <Drawer ...><NavPanel /></Drawer>
  <MobileShell.ScrollArea>
    <DndContextWrapper>...</DndContextWrapper>
  </MobileShell.ScrollArea>
  <MobileTabBar />
</MobileShell>
```

`flex: 1; min-height: 0; overflow-y: auto` is the canonical CSS recipe
for a flex-1 scroll child. Without `min-height: 0`, the child refuses
to shrink below its content height and the page becomes infinite — a
well-known flexbox trap.

### `_layout/index.tsx` — branch on `isMobile`

```tsx
return (
  <HotkeysProvider>
    {/* Shared providers, banners, bridges — both branches need these */}
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
        <Drawer ...><NavPanel /></Drawer>
        <MobileShell.ScrollArea>
          <DndContextWrapper>
            <MarketAuthProvider isDesktop={false}>
              <DesktopHomeLayout><DesktopHome /></DesktopHomeLayout>
              <Suspense fallback={<Loading />}>
                <Outlet />
              </Suspense>
            </MarketAuthProvider>
          </DndContextWrapper>
        </MobileShell.ScrollArea>
        <MobileTabBar />
      </MobileShell>
    ) : (
      <DndContextWrapper>
        <Flexbox horizontal width="100%" height={...}>
          {!isMobile && <NavPanel />}
          {isMobile && <Drawer ...><NavPanel /></Drawer>}
          <DesktopLayoutContainer>...</DesktopLayoutContainer>
        </Flexbox>
      </DndContextWrapper>
    )}

    {/* Shared modals */}
    <Suspense fallback={null}>
      <HotkeyHelperPanel />
      <RegisterHotkeys />
      <CmdkLazy />
      <RetryModal />
      <TgLinkBonusGlobal />
      {isFeedbackModalOpen && <FeedbackModal ... />}
    </Suspense>
  </HotkeysProvider>
);
```

The `else` branch is the current code verbatim — desktop and the
fallback for the kill-switch.

### `AppTheme.tsx` — release `.app` from `100dvh` on mobile

```diff
  .app {
    position: relative;
    overscroll-behavior: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    height: 100%;
    min-height: 100dvh;
    max-height: 100dvh;
    @media (device-width >= 576px) {
      overflow: hidden;
    }
+   @media (max-width: 575px) {
+     /* MobileShell now owns the viewport. Releasing the height
+        constraint lets shell take 100dvh on its own without fighting
+        a parent that's also locked to 100dvh. */
+     min-height: 0;
+     max-height: none;
+     overflow: visible;
+   }
  }
```

### `MobileStickyBar.tsx` — drop the magic 56

```diff
- // Keep in sync with src/features/MobileTabBar height.
- const MOBILE_TAB_BAR_HEIGHT = 56;
+ import { MOBILE_TAB_BAR_HEIGHT } from '@/features/MobileTabBar';
```

Single source of truth. Already feature-flagged off; included so the
constant is consistent when the banner comes back.

## Feature flag — kill-switch

The branch above reads `isMobileShellEnabled`. Resolution order:

1. URL query — `?mobile-shell=on` or `?mobile-shell=off` overrides and
   persists to `localStorage`. Highest priority.
2. `localStorage.getItem('mobile-shell-v2')` — `'on'` | `'off'` from a
   previous URL override.
3. Default — `'on'` (new users get the new shell).

```tsx
// src/hooks/useMobileShellFlag.ts
export function useMobileShellFlag(): boolean {
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const q = sp.get('mobile-shell');
    if (q === 'on' || q === 'off') {
      localStorage.setItem('mobile-shell-v2', q);
      setEnabled(q === 'on');
      return;
    }
    const stored = localStorage.getItem('mobile-shell-v2');
    setEnabled(stored !== 'off');
  }, []);
  return enabled;
}
```

If the user breaks on the new shell, they open
`ask.gptweb.ru/?mobile-shell=off` and instantly get the old layout
back. Removed after ≥48h of stable production.

## Risk register

### UI risks

| #   | Risk                                                                                                                                                                                                                                                                                                                                               | Detection                                                                                          | Mitigation                                                                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1  | Double scroll (body + scrollArea both scrollable)                                                                                                                                                                                                                                                                                                  | Playwright: `document.documentElement.scrollHeight > window.innerHeight` after render              | `body { overflow: hidden }` in `<576px` media query; `.app` already released to `overflow: visible`, body becomes the locked layer                                                                               |
| U2  | Sticky headers inside pages break because scroll moved from body to scrollArea                                                                                                                                                                                                                                                                     | Playwright on `/agent/<id>`: scroll scrollArea, check `header.getBoundingClientRect().top` stays 0 | If broken, sticky headers per-page get `position: sticky; top: 0` explicitly (they should already, but verify)                                                                                                   |
| U3  | TgLinkBonusBanner overlaps with tab bar (banner is `position: fixed` with hard-coded `inset-block-end: 56px + safe-area`)                                                                                                                                                                                                                          | Playwright with banner forced visible; check `banner.rect.bottom <= tabbar.rect.top`               | Banner currently feature-flagged off; when revived, port to `position: sticky; bottom: 0` inside scrollArea, or recalculate against scrollArea instead of viewport                                               |
| U4  | MobileFlowFAB (floating "Создать" on /image, /video) sits at `bottom: env(safe-area-inset-bottom) + 80px` from viewport — now the bar is **in** layout flow at 56px height, so FAB sits 24px above the bar visually. After change, FAB stays viewport-fixed but the bar is also viewport-bottom in flex, so they're stacked Y-wise without overlap | Playwright on /image: `fab.rect.bottom < tabbar.rect.top`                                          | Should work without change; if FAB ends up below the bar, switch FAB to `position: sticky; bottom: 80px` inside scrollArea                                                                                       |
| U5  | CloudBanner ("Бесплатный VPN", 41px) at top — shell needs to either include it as a flex child or accept it as outside                                                                                                                                                                                                                             | Visual + Playwright: banner visible at top, shell occupies remaining height                        | Banner currently rendered outside the layout flexbox (a top-of-app overlay); keep it that way, but subtract `BANNER_HEIGHT` from shell height when banner visible: `height: calc(100dvh - var(--banner-h, 0px))` |
| U6  | iOS Safari URL-bar dance flickers a white strip between scrollArea and tab bar during the 100dvh reflow                                                                                                                                                                                                                                            | Manual on iPhone (user)                                                                            | Acceptable for v1; if reported, switch shell to `100svh` (static viewport, no reflow, slightly shorter when URL bar is hidden)                                                                                   |
| U7  | Android keyboard pushes layout: visualViewport shrinks but `100dvh` doesn't react, so input ends up behind keyboard                                                                                                                                                                                                                                | Manual on Android (user); focus chat input, check input still visible                              | Add `visualViewport.resize` listener that sets `shell.style.height = visualViewport.height` while keyboard is open; revert on hide                                                                               |

### UX risks

| #   | Risk                                                                                           | Detection                                                                                                                          | Mitigation                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X1  | Tab bar items not clickable due to z-index conflict with Drawer mask                           | Playwright: simulate click on tab while Drawer is closed; verify route change                                                      | Bar lives at the end of the flex children so it paints on top of mask-less content; if a modal overlay covers it, that's expected (modal is on top)         |
| X2  | Chat input under keyboard                                                                      | Manual (user) — focus input, observe                                                                                               | See U7 — visualViewport listener                                                                                                                            |
| X3  | Tap on tab fails to switch route — Activity wrapper interferes                                 | Manual + Playwright: tap each of 5 tabs, verify URL changes and content rerenders                                                  | Activity hides DesktopHomeLayout when not on `/` — moving the layout into shell shouldn't change that; if it does, replace Activity with conditional render |
| X4  | Scroll position lost on tab switch                                                             | Manual: scroll down on /chat → switch to /image → switch back; expect scroll restored or reset (we accept either, just consistent) | If unintuitive, add `<ScrollRestoration getKey={l => l.pathname}>` bound to scrollArea                                                                      |
| X5  | Pull-to-refresh broken on iOS due to `overscroll-behavior: contain`                            | Manual (user)                                                                                                                      | If important, drop `overscroll-behavior`; otherwise accept loss (PWA mode doesn't have it anyway)                                                           |
| X6  | iOS back-swipe gesture from left edge conflicts with horizontal scroll containers inside pages | Manual (user)                                                                                                                      | If broken, add `touch-action: pan-y` on horizontal scrollers near the left edge                                                                             |
| X7  | Drawer (burger menu) doesn't open or doesn't reach 100dvh                                      | Manual: tap burger                                                                                                                 | Drawer is antd portal to body — independent of shell. Pass `getContainer={document.body}` explicitly to be safe                                             |
| X8  | Double-tap on tab item triggers iOS zoom                                                       | Manual (user)                                                                                                                      | `touch-action: manipulation` on tab buttons                                                                                                                 |
| X9  | Tab bar pushed off-screen by Android keyboard                                                  | Manual (user)                                                                                                                      | See U7; alternatively, conditionally hide tab bar when keyboard is open (UX decision deferred)                                                              |

### Clientside / lifecycle risks

| #   | Risk                                                                                                              | Detection                                                                                   | Mitigation                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | SSR/hydration mismatch — `useIsMobile()` returns `false` on server, `true` on client → React warns and re-renders | DevTools console for "Hydration mismatch" warning                                           | Wrap mobile branch in `mounted ? <MobileShell>... : null` gate (one-frame flash), or set `useIsMobile` to a `useSyncExternalStore` that defaults to false on server         |
| C2  | `<Activity>` lifecycle in DesktopHomeLayout loses state when wrapper hierarchy changes                            | Manual: navigate `/chat` → `/image` → `/chat`; expect message history retained              | Activity wrapper position is unchanged inside the shell — only the outer wrapper differs; if state lost, verify children references stay equal across rerenders             |
| C3  | MarketAuthProvider context lost for consumers — provider re-mounts in new tree                                    | DevTools React tab on `/agent`; provider present                                            | Provider sits inside scrollArea wrapping all page content — same consumers reachable as before                                                                              |
| C4  | DndContextWrapper drag-and-drop broken — listeners bound to a container that moved                                | Manual: drag PNG file into chat; verify upload starts                                       | DndContextWrapper remains the parent of page content inside scrollArea; listeners work relative to its container                                                            |
| C5  | IntersectionObserver lazy-loaders use `root: null` (viewport), but scroll moved to scrollArea → never trigger     | Manual: scroll up chat history, expect older messages to load                               | Find all IntersectionObserver usages, pass `root: scrollAreaRef.current`. Pre-survey: search the codebase for `new IntersectionObserver` and `useInView` to enumerate sites |
| C6  | React strict mode double-mount in dev breaks portal/effect setup                                                  | `npm run dev`, observe console                                                              | Not a prod blocker; address inline if it shows up                                                                                                                           |
| C7  | `useShowTabBar` returns null on chat threads → shell loses its third flex child → scrollArea takes 100% height    | Manual + Playwright: navigate to `/agent/<id>`, expect tab bar gone, chat takes full height | Already the desired behavior; verified by snapshot                                                                                                                          |
| C8  | PWA mode (no URL bar) has constant `100dvh = 100lvh`                                                              | Manual in PWA (user)                                                                        | No change needed                                                                                                                                                            |

### Performance risks

| #   | Risk                                                           | Detection                                    | Mitigation                                                                                                 |
| --- | -------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| P1  | Reflow on every iOS URL-bar change because shell uses `100dvh` | DevTools Performance recording during scroll | Switch to `100svh` if measurable jank; otherwise accept                                                    |
| P2  | scrollArea loses iOS momentum scroll                           | Manual: flick on chat, expect inertia        | Default `overflow: auto` on iOS 13+ gives inertia; add `-webkit-overflow-scrolling: touch` only if missing |
| P3  | flex:1 + min-height:0 layout pulses on content updates         | DevTools timeline                            | Add `contain: layout` to scrollArea to isolate reflow                                                      |

## Migration plan

Four commits, each independently revertable:

1. **Constants:** Export `MOBILE_TAB_BAR_HEIGHT` from MobileTabBar.
   Update `MobileStickyBar.tsx` to import it. No behavior change.

2. **MobileShell + flag hook:** Add the new `MobileShell.tsx` and
   `useMobileShellFlag.ts`. Wire neither yet. Just landing the building
   blocks, isolated, unused.

3. **The switch:** Replace the JSX branch in `_layout/index.tsx`, drop
   portal logic from `MobileTabBar`, add the `<576px` media query in
   `AppTheme.tsx`. This is the real change. Default flag = `on`.

4. **Smoke fixes:** Reserved for whatever the visual and manual checks
   catch — IntersectionObserver root, FAB position, banner offset,
   keyboard listener. Each fix scoped to one concern.

After ≥48h of stable production with no `?mobile-shell=off` reports —
a fifth commit removes the flag and the `else` branch, deletes
`useMobileShellFlag.ts`.

## Verification

**Automated (Playwright, viewport 390×844):**

- T1 `wrapperRect.bottom === 844 ± 1px` on `/settings/plans`
- T2 `computedBg !== 'rgba(0,0,0,0)'` and `boxShadow` starts with `0px -2px`
- T3 last content element `.bottom <= 844 - 56` after scroll-to-bottom
- T4 open `.ant-drawer`, `tabbar.rect.top` unchanged (was 41px shift)
- T5 screenshots on `/`, `/settings`, `/image`, `/video`, `/settings/plans`
- T6 viewport 1280×800: NavPanel left, no tabbar, layout unchanged

**Manual (on iPhone + Android, user):**

- Tap each of the 5 tabs — URL changes, content rerenders
- Scroll chat history — older messages load (C5)
- Focus chat input — keyboard opens, input remains visible (X2, U7)
- Open burger menu — Drawer slides in, fills screen (X7)
- Pull-to-refresh on /chat — refreshes the page (X5)
- Back-swipe from left edge — navigates back (X6)
- `?mobile-shell=off` in URL — old layout instantly (kill-switch)

Implementation begins after this spec is committed to git and the
implementation plan is written (via `superpowers:writing-plans`).
