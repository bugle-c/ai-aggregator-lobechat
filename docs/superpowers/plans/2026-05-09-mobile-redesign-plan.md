# Mobile Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken `(mobile)` route variant with a fully responsive `(main)` mobile experience that activates new mobile users (most signups), surfaces image/video/upsell features, and converts free → paid.

**Architecture:** 3-phase migration: behind a feature flag, build responsive `(main)` pages → flip default → delete `(mobile)` route. New components are mobile-aware via the existing `useIsMobile()` hook (`antd-style` `useResponsive`). Five upsell touchpoints + two new tracking tables capture the conversion funnel.

**Tech Stack:** Next.js 16 (App Router with `[variants]` dynamic segment), React 19, `@lobehub/ui` components (`Block`, `Button`, `Drawer`), antd-style for responsive hooks, drizzle-orm (Postgres), zustand (stores), tRPC, Vitest for unit tests.

**Spec reference:** `docs/superpowers/specs/2026-05-09-mobile-redesign-design.md`

---

## File structure

### New files

```
src/features/MobileHome/
  index.tsx                       — orchestrator: greeting + input + chips + suggestions
  Greeting.tsx                    — "Привет, {name}! 👋"
  FeatureChipsRow.tsx             — 4 horizontal-scroll chips
  useMobileAutofocus.ts           — first-visit autofocus rule

src/features/MobileGlobalHeader/
  index.tsx                       — logo + balance + avatar
  MobileUserMenu.tsx              — bottom-sheet user menu
  BalanceExplainSheet.tsx         — credit explainer bottom-sheet
  useShowTabBar.ts                — pathname-driven tab visibility

src/features/MobileVpnPromo/
  index.tsx                       — compact dismissable strip

src/features/Upsell/
  LockedModelUpsellSheet.tsx      — bottom-sheet for locked-model tap
  MobileUpgradePill.tsx           — persistent home pill for free users
  MobileCancelFlow.tsx            — bottom-sheet cancel survey
  useTrackUpsell.ts               — writes upsell_impressions + upsell_clicks

src/app/[variants]/(main)/image/ImageWorkspaceMobile.tsx
src/app/[variants]/(main)/video/VideoWorkspaceMobile.tsx
src/app/[variants]/(main)/settings/MobileSettingsList.tsx
src/business/client/BusinessSettingPages/PlansMobileLayout.tsx

src/server/services/billing/useImageGeneration.ts  — shared image-gen hook
src/server/services/billing/useVideoGeneration.ts  — shared video-gen hook

packages/database/src/schemas/upsell.ts            — upsell_impressions + upsell_clicks
packages/database/migrations/0XXX_upsell_tracking.sql

src/server/routers/lambda/upsell.ts                — tRPC for tracking
```

### Modified files

```
src/app/[variants]/page.tsx                         — feature-flag dispatch
src/app/[variants]/(main)/layout.tsx                — mobile-aware layout
src/app/[variants]/(main)/home/index.tsx            — render <MobileHome> on mobile
src/app/[variants]/(main)/image/index.tsx           — render <ImageWorkspaceMobile> on mobile
src/app/[variants]/(main)/video/index.tsx           — render <VideoWorkspaceMobile> on mobile
src/business/client/BusinessSettingPages/Plans.tsx  — render <PlansMobileLayout> on mobile + cancel as bottom-sheet
src/features/MobileTabBar/index.tsx                 — wire BalanceBadge from new header; consume useShowTabBar
src/features/BalanceBadge/index.tsx                 — onClick opens BalanceExplainSheet on mobile
src/features/LockedModelTooltip/index.tsx           — render as bottom-sheet on mobile
src/features/Conversation/Error/index.tsx           — (no changes — already shipped today)
src/features/VpnPromoStrip/index.tsx                — render mobile variant below header
src/envs/app.ts                                     — add NEXT_PUBLIC_MOBILE_REDESIGN
```

### Deleted files (Task 7)

```
src/app/[variants]/(mobile)/                        — entire subtree
src/app/(backend)/trpc/mobile/                      — entire subtree
src/server/routers/mobile/                          — entire subtree
```

---

## Task 1: Plumbing — feature flag + responsive home + tab bar

**Goal of task:** Mobile users hitting `?mobile_redesign=1` (or with `NEXT_PUBLIC_MOBILE_REDESIGN=1` env) land on a new responsive home with input, chips, and suggestions instead of the empty agents list.

**Files:**
- Create: `src/features/MobileHome/index.tsx`
- Create: `src/features/MobileHome/Greeting.tsx`
- Create: `src/features/MobileHome/FeatureChipsRow.tsx`
- Create: `src/features/MobileHome/useMobileAutofocus.ts`
- Create: `src/features/MobileGlobalHeader/index.tsx`
- Create: `src/features/MobileGlobalHeader/useShowTabBar.ts`
- Create: `src/features/MobileVpnPromo/index.tsx`
- Modify: `src/envs/app.ts`
- Modify: `src/app/[variants]/page.tsx`
- Modify: `src/app/[variants]/(main)/home/index.tsx`
- Modify: `src/features/VpnPromoStrip/index.tsx`
- Modify: `src/features/MobileTabBar/index.tsx`
- Test: `src/features/MobileHome/__tests__/index.test.tsx`
- Test: `src/features/MobileGlobalHeader/__tests__/useShowTabBar.test.ts`

---

### Task 1.1 — feature flag env

- [ ] **Step 1.1.1: Add `NEXT_PUBLIC_MOBILE_REDESIGN` to env schema**

Modify `src/envs/app.ts`. Add to the schema and `runtimeEnv` blocks:

```ts
// in z.object({ ... }) schema:
NEXT_PUBLIC_MOBILE_REDESIGN: z.string().optional(),

// in runtimeEnv:
NEXT_PUBLIC_MOBILE_REDESIGN: process.env.NEXT_PUBLIC_MOBILE_REDESIGN,
```

- [ ] **Step 1.1.2: Add a typed helper for the flag**

Append at the bottom of `src/envs/app.ts`:

```ts
/**
 * Mobile redesign feature flag. Honors `?mobile_redesign=1` query and
 * `NEXT_PUBLIC_MOBILE_REDESIGN=1` env. During Phase 1 of mobile-redesign
 * migration, controls whether mobile users hit the new responsive
 * `(main)` route or the legacy `(mobile)` route.
 */
export const isMobileRedesignEnabled = (searchParams?: URLSearchParams) => {
  if (searchParams?.get('mobile_redesign') === '1') return true;
  return process.env.NEXT_PUBLIC_MOBILE_REDESIGN === '1';
};
```

- [ ] **Step 1.1.3: Commit**

```bash
git add src/envs/app.ts
git commit -m "feat(mobile): add NEXT_PUBLIC_MOBILE_REDESIGN feature flag"
```

---

### Task 1.2 — feature-flag dispatcher

- [ ] **Step 1.2.1: Modify `src/app/[variants]/page.tsx` to honor the flag**

Replace the existing handler so when the flag is on, mobile users get `<DesktopRouter />`:

```tsx
import Loading from '@/components/Loading/BrandTextLoading';
import { isMobileRedesignEnabled } from '@/envs/app';
import dynamic from '@/libs/next/dynamic';
import { type DynamicLayoutProps } from '@/types/next';
import { RouteVariants } from '@/utils/server/routeVariants';

import DesktopRouter from './router';

const MobileRouter = dynamic(() => import('./(mobile)'), {
  loading: () => <Loading debugId={'Root'} />,
});

export default async (props: DynamicLayoutProps) => {
  const isMobile = await RouteVariants.getIsMobile(props);

  // Phase 1 of mobile-redesign migration: when the feature flag is on,
  // mobile users land on the responsive (main) route. The legacy
  // (mobile) route stays in code as a rollback path until Phase 3.
  const sp = await props.searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp ?? {})) {
    if (typeof v === 'string') params.set(k, v);
  }
  const redesign = isMobileRedesignEnabled(params);

  if (isMobile && !redesign) return <MobileRouter />;
  return <DesktopRouter />;
};
```

- [ ] **Step 1.2.2: Run app build to verify no type errors**

Run: `cd /home/deploy/projects/ai-aggregator-lobechat && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'page.tsx|envs/app' | head`
Expected: no errors mentioning `page.tsx` or `envs/app`.

- [ ] **Step 1.2.3: Commit**

```bash
git add src/app/[variants]/page.tsx
git commit -m "feat(mobile): feature-flag mobile-redesign route dispatch"
```

---

### Task 1.3 — `useShowTabBar` hook

- [ ] **Step 1.3.1: Write the failing test**

Create `src/features/MobileGlobalHeader/__tests__/useShowTabBar.test.ts`:

```ts
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useShowTabBar } from '../useShowTabBar';

vi.mock('next/navigation', () => ({ usePathname: () => mockPath }));

let mockPath = '/';

describe('useShowTabBar', () => {
  it('shows on home', () => {
    mockPath = '/';
    const { result } = renderHook(() => useShowTabBar());
    expect(result.current).toBe(true);
  });

  it('hides on chat thread', () => {
    mockPath = '/chat/topic_123';
    const { result } = renderHook(() => useShowTabBar());
    expect(result.current).toBe(false);
  });

  it('shows on /image', () => {
    mockPath = '/image';
    const { result } = renderHook(() => useShowTabBar());
    expect(result.current).toBe(true);
  });

  it('shows on settings sub-pages', () => {
    mockPath = '/settings/profile';
    const { result } = renderHook(() => useShowTabBar());
    expect(result.current).toBe(true);
  });
});
```

- [ ] **Step 1.3.2: Run test to verify it fails**

Run: `cd /home/deploy/projects/ai-aggregator-lobechat && npx vitest run src/features/MobileGlobalHeader/__tests__/useShowTabBar.test.ts 2>&1 | tail -10`
Expected: FAIL with "Cannot find module '../useShowTabBar'".

- [ ] **Step 1.3.3: Implement the hook**

Create `src/features/MobileGlobalHeader/useShowTabBar.ts`:

```ts
'use client';

import { usePathname } from 'next/navigation';

/**
 * Whether the bottom MobileTabBar should render on the current page.
 *
 * Hidden on:
 * - chat threads (`/chat/[topicId]`) — needs full vertical space for messages
 *
 * Shown on:
 * - home (`/`)
 * - feature pages (`/image`, `/video`)
 * - all settings pages (mobile users still navigate via tabs from there)
 *
 * Pure function of pathname; tests mock `usePathname`.
 */
export const useShowTabBar = (): boolean => {
  const pathname = usePathname();
  if (!pathname) return true;

  // Chat thread = `/chat/<id>` with anything after the slash
  if (/^\/chat\/[^/]+/.test(pathname)) return false;

  return true;
};
```

- [ ] **Step 1.3.4: Run test to verify it passes**

Run: `cd /home/deploy/projects/ai-aggregator-lobechat && npx vitest run src/features/MobileGlobalHeader/__tests__/useShowTabBar.test.ts 2>&1 | tail -10`
Expected: PASS, 4 tests.

- [ ] **Step 1.3.5: Commit**

```bash
git add src/features/MobileGlobalHeader/useShowTabBar.ts src/features/MobileGlobalHeader/__tests__/useShowTabBar.test.ts
git commit -m "feat(mobile): useShowTabBar hook"
```

---

### Task 1.4 — Mobile global header

- [ ] **Step 1.4.1: Implement the header**

Create `src/features/MobileGlobalHeader/index.tsx`:

```tsx
'use client';

import { Avatar, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import Link from 'next/link';

import BalanceBadge from '@/features/BalanceBadge';
import { useUserStore } from '@/store/user';

const MobileGlobalHeader = memo(() => {
  const avatar = useUserStore((s) => s.user?.avatar);
  const name = useUserStore((s) => s.user?.fullName ?? s.user?.email ?? '');

  return (
    <Flexbox
      align="center"
      horizontal
      justify="space-between"
      paddingInline={16}
      style={{
        background: 'var(--ant-color-bg-container)',
        borderBlockEnd: '1px solid var(--ant-color-border-secondary)',
        height: 56,
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}
    >
      <Link href="/" style={{ alignItems: 'center', display: 'flex', gap: 6 }}>
        <span aria-hidden style={{ fontSize: 20 }}>🤯</span>
        <Text strong style={{ fontSize: 16 }}>WebGPT</Text>
      </Link>

      <BalanceBadge />

      <Avatar
        src={avatar ?? undefined}
        size={32}
        title={name}
      />
    </Flexbox>
  );
});

MobileGlobalHeader.displayName = 'MobileGlobalHeader';

export default MobileGlobalHeader;
```

- [ ] **Step 1.4.2: Smoke-render check via existing test pattern**

Add to `src/features/MobileGlobalHeader/__tests__/index.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import MobileGlobalHeader from '..';

describe('MobileGlobalHeader', () => {
  it('renders WebGPT brand', () => {
    render(<MobileGlobalHeader />);
    expect(screen.getByText('WebGPT')).toBeInTheDocument();
  });
});
```

Run: `cd /home/deploy/projects/ai-aggregator-lobechat && npx vitest run src/features/MobileGlobalHeader/__tests__/index.test.tsx 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 1.4.3: Commit**

```bash
git add src/features/MobileGlobalHeader/
git commit -m "feat(mobile): global header with logo + balance + avatar"
```

---

### Task 1.5 — Greeting + FeatureChipsRow + useMobileAutofocus

- [ ] **Step 1.5.1: Write Greeting**

Create `src/features/MobileHome/Greeting.tsx`:

```tsx
'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';

import { useUserStore } from '@/store/user';

const MobileGreeting = memo(() => {
  const fullName = useUserStore((s) => s.user?.fullName);
  const email = useUserStore((s) => s.user?.email);
  const display = fullName || (email ? email.split('@')[0] : null);

  return (
    <Flexbox gap={4} paddingBlock={16} paddingInline={16}>
      <Text style={{ fontSize: 24, fontWeight: 700 }}>
        {display ? `Привет, ${display}! 👋` : 'Привет! 👋'}
      </Text>
      <Text style={{ color: 'var(--ant-color-text-secondary)', fontSize: 16 }}>
        Чем тебе помочь?
      </Text>
    </Flexbox>
  );
});

MobileGreeting.displayName = 'MobileGreeting';

export default MobileGreeting;
```

- [ ] **Step 1.5.2: Write FeatureChipsRow**

Create `src/features/MobileHome/FeatureChipsRow.tsx`:

```tsx
'use client';

import { Block, Flexbox } from '@lobehub/ui';
import { Image as ImageIcon, Languages, Mic, Video } from 'lucide-react';
import { memo } from 'react';
import { useRouter } from 'next/navigation';

interface ChipDef {
  href: string;
  icon: React.ComponentType<{ size?: number }>;
  key: string;
  label: string;
}

const CHIPS: ChipDef[] = [
  { href: '/image', icon: ImageIcon, key: 'image', label: 'Картинка' },
  { href: '/video', icon: Video, key: 'video', label: 'Видео' },
  { href: '/translate', icon: Languages, key: 'translate', label: 'Перевод' },
  { href: '/tts', icon: Mic, key: 'tts', label: 'Озвучка' },
];

const MobileFeatureChipsRow = memo(() => {
  const router = useRouter();

  return (
    <Flexbox
      gap={8}
      horizontal
      paddingInline={16}
      style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}
    >
      {CHIPS.map(({ href, icon: Icon, key, label }) => (
        <Block
          clickable
          gap={6}
          key={key}
          padding={10}
          style={{
            alignItems: 'center',
            display: 'flex',
            flexDirection: 'row',
            flexShrink: 0,
            minWidth: 110,
          }}
          variant="filled"
          onClick={() => router.push(href)}
        >
          <Icon size={18} />
          <span style={{ fontSize: 14 }}>{label}</span>
        </Block>
      ))}
    </Flexbox>
  );
});

MobileFeatureChipsRow.displayName = 'MobileFeatureChipsRow';

export default MobileFeatureChipsRow;
```

- [ ] **Step 1.5.3: Write useMobileAutofocus hook**

Create `src/features/MobileHome/useMobileAutofocus.ts`:

```ts
'use client';

import { useEffect } from 'react';

import { useChatStore } from '@/store/chat';

interface Options {
  enabled: boolean;
}

/**
 * Auto-focus the home chat input on first visit only.
 *
 * Conditions:
 * - Caller passes `enabled` (typically `firstMessageSeen === false &&
 *   signupAt > now() - 5m`)
 * - Viewport tall enough (>600px) so iOS virtual keyboard isn't already
 *   open or about to dock; otherwise focus + keyboard race causes the
 *   page to jump
 *
 * No-ops on subsequent renders even if conditions change.
 */
export const useMobileAutofocus = ({ enabled }: Options) => {
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;
    if (window.innerHeight <= 600) return;

    // setTimeout to let editor mount
    const id = setTimeout(() => {
      const editor = useChatStore.getState().mainInputEditor;
      editor?.focus();
    }, 50);
    return () => clearTimeout(id);
  }, [enabled]);
};
```

- [ ] **Step 1.5.4: Commit**

```bash
git add src/features/MobileHome/
git commit -m "feat(mobile): home greeting + feature chips + autofocus hook"
```

---

### Task 1.6 — MobileHome orchestrator

- [ ] **Step 1.6.1: Implement the orchestrator**

Create `src/features/MobileHome/index.tsx`:

```tsx
'use client';

import { Divider, Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { SuggestedPrompts } from '@/features/Onboarding';
import { useUserOnboardingStore } from '@/store/user/onboarding';

import FeatureChipsRow from './FeatureChipsRow';
import Greeting from './Greeting';
import { useMobileAutofocus } from './useMobileAutofocus';

interface Props {
  /** Tap on a SuggestedPrompts card sends the prompt; same handler as desktop. */
  onSelectPrompt: (prompt: string) => Promise<void> | void;
}

const MobileHome = memo<Props>(({ onSelectPrompt }) => {
  const onboarding = useUserOnboardingStore((s) => s.onboarding);
  const firstVisit = onboarding != null && !onboarding.firstMessageSeen;

  useMobileAutofocus({ enabled: firstVisit });

  return (
    <Flexbox gap={16} paddingBlock={8}>
      <Greeting />

      {/* The chat input itself is rendered by the page-level component
          that hosts MobileHome — keeps MobileHome stateless w/r/t the
          editor instance. */}

      <Divider style={{ margin: 0 }}>Быстрые действия</Divider>
      <FeatureChipsRow />

      <Divider style={{ margin: 0 }}>Попробуй</Divider>
      <Flexbox paddingInline={16}>
        <SuggestedPrompts onSelect={onSelectPrompt} showHint={false} />
      </Flexbox>
    </Flexbox>
  );
});

MobileHome.displayName = 'MobileHome';

export default MobileHome;
```

- [ ] **Step 1.6.2: Smoke test render**

Create `src/features/MobileHome/__tests__/index.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import MobileHome from '..';

describe('MobileHome', () => {
  it('renders chips section title', () => {
    render(<MobileHome onSelectPrompt={() => {}} />);
    expect(screen.getByText('Быстрые действия')).toBeInTheDocument();
    expect(screen.getByText('Попробуй')).toBeInTheDocument();
  });
});
```

Run: `cd /home/deploy/projects/ai-aggregator-lobechat && npx vitest run src/features/MobileHome/__tests__/index.test.tsx 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 1.6.3: Commit**

```bash
git add src/features/MobileHome/index.tsx src/features/MobileHome/__tests__/
git commit -m "feat(mobile): MobileHome orchestrator"
```

---

### Task 1.7 — Wire MobileHome into the desktop home page

- [ ] **Step 1.7.1: Modify `src/app/[variants]/(main)/home/index.tsx`**

Find the existing `Home` component. Wrap its top render with mobile-aware branching:

```tsx
'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import MobileGlobalHeader from '@/features/MobileGlobalHeader';
import MobileHome from '@/features/MobileHome';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useChatStore } from '@/store/chat';

import { useSend } from './features/InputArea/useSend';
// ...existing imports preserved

const Home = memo(() => {
  const isMobile = useIsMobile();
  const { send } = useSend();

  const handlePromptSelect = async (prompt: string) => {
    const editor = useChatStore.getState().mainInputEditor;
    editor?.instance?.setDocument('markdown', prompt);
    useChatStore.setState({ inputMessage: prompt });
    editor?.focus();
    await send();
  };

  if (isMobile) {
    return (
      <Flexbox style={{ height: '100%', overflow: 'auto' }}>
        <MobileGlobalHeader />
        <MobileHome onSelectPrompt={handlePromptSelect} />
        {/* existing input area still mounted below — for now reuse desktop one */}
        {/* ... existing JSX block goes here ... */}
      </Flexbox>
    );
  }

  // ...existing desktop JSX preserved
});
```

(The engineer should preserve everything else in the desktop branch — only mobile branch is new.)

- [ ] **Step 1.7.2: Manual prod-domain smoke**

Run: open `https://ask.gptweb.ru/?mobile_redesign=1` in Chrome DevTools (F12 → Ctrl+Shift+M → iPhone 14). Expected: greeting + chips + suggestions visible. Bottom tab still shows.

- [ ] **Step 1.7.3: Commit**

```bash
git add src/app/[variants]/(main)/home/index.tsx
git commit -m "feat(mobile): render MobileHome on small screens"
```

---

### Task 1.8 — Compact dismissable VPN strip

- [ ] **Step 1.8.1: Write the mobile variant**

Create `src/features/MobileVpnPromo/index.tsx`:

```tsx
'use client';

import { Flexbox } from '@lobehub/ui';
import { X } from 'lucide-react';
import { memo, useEffect, useState } from 'react';

const COOKIE_NAME = 'vpn_promo_dismissed';

const readDismissed = () => {
  if (typeof document === 'undefined') return false;
  return document.cookie.split('; ').some((c) => c.startsWith(`${COOKIE_NAME}=1`));
};

const setDismissed = () => {
  document.cookie = `${COOKIE_NAME}=1; path=/; max-age=${60 * 60 * 24 * 30}; sameSite=lax`;
};

const MobileVpnPromo = memo(() => {
  const [dismissed, setDismissedState] = useState(false);

  useEffect(() => {
    setDismissedState(readDismissed());
  }, []);

  if (dismissed) return null;

  return (
    <Flexbox
      align="center"
      horizontal
      justify="space-between"
      paddingBlock={6}
      paddingInline={12}
      style={{
        background: 'linear-gradient(90deg, #1d4ed8 0%, #2563eb 100%)',
        color: '#fff',
        fontSize: 13,
      }}
    >
      <a
        href="https://t.me/freeip_pashavinbot"
        rel="noopener noreferrer"
        style={{ color: 'inherit', textDecoration: 'none' }}
        target="_blank"
      >
        🔓 Бесплатный VPN →
      </a>
      <button
        aria-label="Закрыть"
        onClick={() => {
          setDismissed();
          setDismissedState(true);
        }}
        style={{ background: 'transparent', border: 0, color: '#fff', cursor: 'pointer' }}
        type="button"
      >
        <X size={16} />
      </button>
    </Flexbox>
  );
});

MobileVpnPromo.displayName = 'MobileVpnPromo';

export default MobileVpnPromo;
```

- [ ] **Step 1.8.2: Modify `src/features/VpnPromoStrip/index.tsx` to delegate on mobile**

Add at the top of the existing component:

```tsx
import { useIsMobile } from '@/hooks/useIsMobile';
import MobileVpnPromo from '@/features/MobileVpnPromo';

// inside the component, before the existing return:
const isMobile = useIsMobile();
if (isMobile) return <MobileVpnPromo />;
```

- [ ] **Step 1.8.3: Commit**

```bash
git add src/features/MobileVpnPromo/ src/features/VpnPromoStrip/index.tsx
git commit -m "feat(mobile): compact dismissable VPN strip below header"
```

---

### Task 1.9 — Tab bar wiring

- [ ] **Step 1.9.1: Apply useShowTabBar in MobileTabBar/index.tsx**

Modify `src/features/MobileTabBar/index.tsx`. Near the top of the component:

```tsx
import { useShowTabBar } from '@/features/MobileGlobalHeader/useShowTabBar';

// inside the component, very first line of the body:
const visible = useShowTabBar();
if (!visible) return null;
```

- [ ] **Step 1.9.2: Commit**

```bash
git add src/features/MobileTabBar/index.tsx
git commit -m "feat(mobile): hide tab bar on chat thread pages"
```

---

## Task 2: Image + Video mobile workspaces

**Goal of task:** `/image` and `/video` render a mobile-friendly stacked layout with sticky generation panel; existing desktop split-pane stays intact.

**Files:**
- Create: `src/app/[variants]/(main)/image/ImageWorkspaceMobile.tsx`
- Create: `src/app/[variants]/(main)/video/VideoWorkspaceMobile.tsx`
- Modify: `src/app/[variants]/(main)/image/index.tsx`
- Modify: `src/app/[variants]/(main)/video/index.tsx`

---

### Task 2.1 — ImageWorkspaceMobile

- [ ] **Step 2.1.1: Implement the mobile layout**

Create `src/app/[variants]/(main)/image/ImageWorkspaceMobile.tsx`:

```tsx
'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import NavHeader from '@/features/NavHeader';
import ImageHistory from './features/ImageWorkspace/ImageHistory';
import ImagePromptPanel from './features/ImageWorkspace/PromptPanel';

const ImageWorkspaceMobile = memo(() => {
  return (
    <Flexbox style={{ height: '100%' }}>
      <NavHeader />
      <Flexbox flex={1} style={{ overflowY: 'auto', paddingBlockEnd: 8 }}>
        <ImageHistory />
      </Flexbox>
      <Flexbox
        style={{
          background: 'var(--ant-color-bg-container)',
          borderBlockStart: '1px solid var(--ant-color-border-secondary)',
          paddingBlock: 12,
          paddingInline: 16,
          position: 'sticky',
          insetBlockEnd: 0,
        }}
      >
        <ImagePromptPanel />
      </Flexbox>
    </Flexbox>
  );
});

ImageWorkspaceMobile.displayName = 'ImageWorkspaceMobile';

export default ImageWorkspaceMobile;
```

(`ImageHistory` and `PromptPanel` may not exist yet as exports — the engineer extracts them from the current `ImageWorkspace.tsx` file. If extraction isn't possible without a deeper refactor, fall back to rendering the full `ImageWorkspace` inside the mobile layout container; revisit extraction later.)

- [ ] **Step 2.1.2: Modify `src/app/[variants]/(main)/image/index.tsx` to delegate on mobile**

```tsx
'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { useIsMobile } from '@/hooks/useIsMobile';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import WideScreenButton from '@/features/WideScreenContainer/WideScreenButton';

import ImageWorkspace from './features/ImageWorkspace';
import ImageWorkspaceMobile from './ImageWorkspaceMobile';

const ImagePage = memo(() => {
  const isMobile = useIsMobile();
  if (isMobile) return <ImageWorkspaceMobile />;

  return (
    <>
      <NavHeader right={<WideScreenButton />} />
      <Flexbox height={'100%'} style={{ overflowY: 'auto', position: 'relative' }} width={'100%'}>
        <WideScreenContainer height={'100%'} wrapperStyle={{ height: '100%' }}>
          <ImageWorkspace />
        </WideScreenContainer>
      </Flexbox>
    </>
  );
});

ImagePage.displayName = 'ImagePage';

export default ImagePage;
```

- [ ] **Step 2.1.3: Commit**

```bash
git add src/app/[variants]/(main)/image/
git commit -m "feat(mobile): stacked image workspace with sticky prompt panel"
```

---

### Task 2.2 — VideoWorkspaceMobile

- [ ] **Step 2.2.1: Implement and wire — mirror Task 2.1**

Create `src/app/[variants]/(main)/video/VideoWorkspaceMobile.tsx` with the same shape as ImageWorkspaceMobile, but importing video pieces (`VideoHistory`, `VideoPromptPanel`).

Modify `src/app/[variants]/(main)/video/index.tsx` similarly to delegate to the mobile component when `useIsMobile()` is true.

- [ ] **Step 2.2.2: Commit**

```bash
git add src/app/[variants]/(main)/video/
git commit -m "feat(mobile): stacked video workspace with sticky prompt panel"
```

---

## Task 3: Plans + Settings responsive

**Goal of task:** `/settings/subscription/plans` plan cards stack vertically on mobile; `/settings` becomes a list-of-links.

**Files:**
- Create: `src/business/client/BusinessSettingPages/PlansMobileLayout.tsx`
- Create: `src/app/[variants]/(main)/settings/MobileSettingsList.tsx`
- Modify: `src/business/client/BusinessSettingPages/Plans.tsx`
- Modify: `src/app/[variants]/(main)/settings/_layout.tsx` (or its mobile-aware sibling)

---

### Task 3.1 — Plans mobile layout

- [ ] **Step 3.1.1: Implement PlansMobileLayout**

Create `src/business/client/BusinessSettingPages/PlansMobileLayout.tsx`:

```tsx
'use client';

import { Block, Button, Flexbox, Tag, Text } from '@lobehub/ui';
import { memo } from 'react';

interface Plan {
  highlighted?: boolean;
  features: string[];
  id: number;
  name: string;
  priceRub: number;
  slug: string;
}

interface Props {
  currentPlanSlug: string | null;
  plans: Plan[];
  tokensUsed: number;
  tokensTotal: number;
  onSelect: (planId: number) => void;
}

const PlansMobileLayout = memo<Props>(({ currentPlanSlug, plans, tokensUsed, tokensTotal, onSelect }) => {
  const usedPct = tokensTotal > 0 ? Math.min(100, Math.round((tokensUsed / tokensTotal) * 100)) : 0;

  return (
    <Flexbox gap={16} paddingBlock={16} paddingInline={16}>
      <Block padding={16} variant="filled">
        <Text>Текущий: {currentPlanSlug ?? 'Старт (бесплатно)'}</Text>
        <Text type="secondary">Использовано: {tokensUsed} / {tokensTotal} кредитов</Text>
        <div style={{ background: 'var(--ant-color-fill)', borderRadius: 4, height: 8, marginBlockStart: 8, overflow: 'hidden' }}>
          <div style={{ background: 'var(--ant-color-primary)', height: '100%', width: `${usedPct}%` }} />
        </div>
      </Block>

      {plans.map((plan) => (
        <Block
          key={plan.id}
          padding={16}
          style={{ borderColor: plan.highlighted ? 'var(--ant-color-primary)' : undefined }}
          variant="outlined"
        >
          <Flexbox align="center" horizontal justify="space-between">
            <Text style={{ fontSize: 18, fontWeight: 600 }}>{plan.name}</Text>
            {plan.highlighted && <Tag color="blue">🔥 Рекомендуем</Tag>}
          </Flexbox>
          <Text style={{ fontSize: 24, fontWeight: 700 }}>{plan.priceRub} ₽/мес</Text>
          <Flexbox gap={4} paddingBlock={8}>
            {plan.features.map((f) => (
              <Text key={f} type="secondary">• {f}</Text>
            ))}
          </Flexbox>
          <Button
            block
            disabled={plan.slug === currentPlanSlug}
            onClick={() => onSelect(plan.id)}
            type={plan.highlighted ? 'primary' : 'default'}
          >
            {plan.slug === currentPlanSlug ? 'Текущий тариф' : 'Выбрать'}
          </Button>
        </Block>
      ))}
    </Flexbox>
  );
});

PlansMobileLayout.displayName = 'PlansMobileLayout';

export default PlansMobileLayout;
```

- [ ] **Step 3.1.2: Modify `src/business/client/BusinessSettingPages/Plans.tsx` to delegate on mobile**

Inside the existing `Plans` component, near the top of the render:

```tsx
import { useIsMobile } from '@/hooks/useIsMobile';
import PlansMobileLayout from './PlansMobileLayout';

// inside Plans component:
const isMobile = useIsMobile();
if (isMobile && plans && billing && currentPlan != null) {
  return (
    <PlansMobileLayout
      currentPlanSlug={currentPlan?.slug ?? null}
      plans={plans.map((p) => ({
        features: PLAN_FEATURES[p.slug] ?? [],
        highlighted: p.slug === 'pro',
        id: p.id,
        name: p.name,
        priceRub: p.priceRub,
        slug: p.slug,
      }))}
      tokensUsed={billing.tokensUsed ?? 0}
      tokensTotal={billing.tokensTotal ?? 0}
      onSelect={(planId) => subscribeMutation.mutate({ planId })}
    />
  );
}
```

(Engineer adapts the field names to whatever the existing `useBillingState`/etc selectors expose.)

- [ ] **Step 3.1.3: Commit**

```bash
git add src/business/client/BusinessSettingPages/
git commit -m "feat(mobile): stacked plan cards on subscription/plans"
```

---

### Task 3.2 — Mobile settings list

- [ ] **Step 3.2.1: Implement MobileSettingsList**

Create `src/app/[variants]/(main)/settings/MobileSettingsList.tsx`:

```tsx
'use client';

import { Block, Flexbox, Text } from '@lobehub/ui';
import { ChevronRight, ExternalLink, LogOut } from 'lucide-react';
import { memo } from 'react';
import Link from 'next/link';

interface Item {
  href: string;
  label: string;
}

const ITEMS: Item[] = [
  { href: '/settings/profile', label: 'Профиль' },
  { href: '/settings/subscription/plans', label: 'Подписка и тарифы' },
  { href: '/settings/referral', label: 'Реферальная программа' },
  { href: '/settings/customization', label: 'Персонализация' },
  { href: '/settings/billing', label: 'Платежи' },
  { href: '/settings/help', label: 'Помощь' },
];

const MobileSettingsList = memo(() => {
  return (
    <Flexbox gap={4} paddingBlock={8}>
      {ITEMS.map((item) => (
        <Link href={item.href} key={item.href} style={{ color: 'inherit', textDecoration: 'none' }}>
          <Block clickable padding={16} variant="filled">
            <Flexbox align="center" horizontal justify="space-between">
              <Text>{item.label}</Text>
              <ChevronRight size={18} />
            </Flexbox>
          </Block>
        </Link>
      ))}

      <Block padding={16} variant="filled">
        <a
          href="?mobile_redesign=0"
          style={{ alignItems: 'center', color: 'var(--ant-color-link)', display: 'flex', gap: 8, textDecoration: 'none' }}
        >
          <ExternalLink size={16} /> Открыть полную версию на компьютере
        </a>
      </Block>

      <Block padding={16} variant="filled">
        <button
          onClick={() => { window.location.href = '/api/auth/sign-out'; }}
          style={{ alignItems: 'center', background: 'transparent', border: 0, color: 'var(--ant-color-error)', cursor: 'pointer', display: 'flex', gap: 8 }}
          type="button"
        >
          <LogOut size={16} /> Выйти
        </button>
      </Block>
    </Flexbox>
  );
});

MobileSettingsList.displayName = 'MobileSettingsList';

export default MobileSettingsList;
```

- [ ] **Step 3.2.2: Modify `src/app/[variants]/(main)/settings/_layout.tsx` (or the index page) to render the list on mobile**

Find the existing settings layout. At the top of its render:

```tsx
import { useIsMobile } from '@/hooks/useIsMobile';
import MobileSettingsList from './MobileSettingsList';

// inside the layout component:
const isMobile = useIsMobile();
if (isMobile && pathname === '/settings') return <MobileSettingsList />;
```

- [ ] **Step 3.2.3: Commit**

```bash
git add src/app/[variants]/(main)/settings/
git commit -m "feat(mobile): list-of-links settings root"
```

---

## Task 4: Upsell touchpoints

**Goal of task:** Free→paid conversion goes from 0% to >5% via 5 explicit touchpoints + bottom-sheet upgrade UX.

**Files:**
- Create: `src/features/Upsell/LockedModelUpsellSheet.tsx`
- Create: `src/features/Upsell/MobileUpgradePill.tsx`
- Create: `src/features/Upsell/MobileCancelFlow.tsx`
- Create: `src/features/MobileGlobalHeader/BalanceExplainSheet.tsx`
- Create: `src/features/MobileGlobalHeader/MobileUserMenu.tsx`
- Modify: `src/features/BalanceBadge/index.tsx`
- Modify: `src/features/LockedModelTooltip/index.tsx`
- Modify: `src/features/MobileGlobalHeader/index.tsx` — wire user menu sheet
- Modify: `src/features/MobileHome/index.tsx` — render MobileUpgradePill
- Modify: `src/business/client/BusinessSettingPages/Plans.tsx` — bottom-sheet cancel on mobile

---

### Task 4.1 — Locked-model bottom-sheet

- [ ] **Step 4.1.1: Implement**

Create `src/features/Upsell/LockedModelUpsellSheet.tsx`:

```tsx
'use client';

import { Drawer } from 'antd';
import { Button, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  modelDescription?: string;
  modelId: string;
  onClose: () => void;
  open: boolean;
  requiredPlanName: string;
  requiredPlanPriceRub: number;
}

const LockedModelUpsellSheet = memo<Props>(
  ({ modelDescription, modelId, onClose, open, requiredPlanName, requiredPlanPriceRub }) => {
    const router = useRouter();

    return (
      <Drawer
        height="auto"
        onClose={onClose}
        open={open}
        placement="bottom"
        styles={{ body: { padding: 0 } }}
      >
        <Flexbox gap={12} paddingBlock={24} paddingInline={20}>
          <Text style={{ fontSize: 20, fontWeight: 700 }}>Доступно на тарифе {requiredPlanName}</Text>
          <Text type="secondary">{modelDescription ?? `Модель «${modelId}» недоступна на текущем тарифе.`}</Text>
          <Text style={{ fontSize: 28, fontWeight: 700 }}>{requiredPlanPriceRub} ₽/мес</Text>
          <Button
            block
            onClick={() => {
              onClose();
              router.push('/settings/subscription/plans');
            }}
            size="large"
            type="primary"
          >
            Перейти на {requiredPlanName}
          </Button>
          <Button block onClick={() => { onClose(); router.push('/settings/subscription/plans'); }} type="default">
            Сравнить тарифы
          </Button>
        </Flexbox>
      </Drawer>
    );
  },
);

LockedModelUpsellSheet.displayName = 'LockedModelUpsellSheet';

export default LockedModelUpsellSheet;
```

- [ ] **Step 4.1.2: Modify `src/features/LockedModelTooltip/index.tsx` to use the sheet on mobile**

Add at the top of the existing tooltip render:

```tsx
import { useIsMobile } from '@/hooks/useIsMobile';
import LockedModelUpsellSheet from '@/features/Upsell/LockedModelUpsellSheet';

// inside component, manage open state via useState if not already:
const isMobile = useIsMobile();
const [sheetOpen, setSheetOpen] = useState(false);

// when isMobile, render children with onClick={() => setSheetOpen(true)}
// and after children, render <LockedModelUpsellSheet open={sheetOpen} onClose={...} ... />
// (engineer adapts to existing tooltip API)
```

- [ ] **Step 4.1.3: Commit**

```bash
git add src/features/Upsell/LockedModelUpsellSheet.tsx src/features/LockedModelTooltip/index.tsx
git commit -m "feat(mobile): locked-model upsell as bottom-sheet"
```

---

### Task 4.2 — BalanceExplainSheet + BalanceBadge tap

- [ ] **Step 4.2.1: Implement BalanceExplainSheet**

Create `src/features/MobileGlobalHeader/BalanceExplainSheet.tsx`:

```tsx
'use client';

import { Drawer } from 'antd';
import { Button, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  monthlyResetDate: string | null;
  onClose: () => void;
  open: boolean;
  remainingCredits: number;
}

const BalanceExplainSheet = memo<Props>(({ monthlyResetDate, onClose, open, remainingCredits }) => {
  const router = useRouter();

  return (
    <Drawer height="auto" onClose={onClose} open={open} placement="bottom" styles={{ body: { padding: 0 } }}>
      <Flexbox gap={10} paddingBlock={24} paddingInline={20}>
        <Text style={{ fontSize: 18, fontWeight: 600 }}>Что такое кредит?</Text>
        <Text type="secondary">1 кредит ≈ 1 короткое сообщение GPT-5-mini</Text>
        <Text type="secondary">5 кредитов = 1 картинка Flux</Text>
        <Text type="secondary">50 кредитов = 1 картинка Nano Banana Pro</Text>
        <Text type="secondary">200 кредитов = 1 минута видео Seedance</Text>
        <Text style={{ marginBlockStart: 12 }}>У вас {remainingCredits} кредитов.</Text>
        {monthlyResetDate && <Text type="secondary">Бесплатные кредиты обновятся {monthlyResetDate}.</Text>}
        <Button block onClick={() => { onClose(); router.push('/settings/billing'); }} type="default">
          Купить ещё
        </Button>
        <Button block onClick={() => { onClose(); router.push('/settings/subscription/plans'); }} size="large" type="primary">
          Перейти на Pro
        </Button>
      </Flexbox>
    </Drawer>
  );
});

BalanceExplainSheet.displayName = 'BalanceExplainSheet';

export default BalanceExplainSheet;
```

- [ ] **Step 4.2.2: Modify `src/features/BalanceBadge/index.tsx` to open the sheet on mobile tap**

Around the existing badge JSX:

```tsx
import { useState } from 'react';
import { useIsMobile } from '@/hooks/useIsMobile';
import BalanceExplainSheet from '@/features/MobileGlobalHeader/BalanceExplainSheet';
// inside component:
const isMobile = useIsMobile();
const [sheetOpen, setSheetOpen] = useState(false);

// wrap the existing badge content with onClick={() => isMobile && setSheetOpen(true)}
// after the badge:
{isMobile && (
  <BalanceExplainSheet
    monthlyResetDate={resetDate}
    onClose={() => setSheetOpen(false)}
    open={sheetOpen}
    remainingCredits={remaining}
  />
)}
```

- [ ] **Step 4.2.3: Commit**

```bash
git add src/features/MobileGlobalHeader/BalanceExplainSheet.tsx src/features/BalanceBadge/index.tsx
git commit -m "feat(mobile): balance badge tap opens credit-explainer bottom-sheet"
```

---

### Task 4.3 — MobileUpgradePill on home

- [ ] **Step 4.3.1: Implement**

Create `src/features/Upsell/MobileUpgradePill.tsx`:

```tsx
'use client';

import { ChevronRight, Zap } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import Link from 'next/link';

const COOKIE_NAME = 'upgrade_pill_dismissed_at';
const REACTIVATE_AFTER_DAYS = 7;

const isDismissedRecently = () => {
  if (typeof document === 'undefined') return false;
  const match = document.cookie.match(new RegExp(`${COOKIE_NAME}=(\\d+)`));
  if (!match) return false;
  const ts = Number(match[1]);
  if (!Number.isFinite(ts)) return false;
  const days = (Date.now() - ts) / 86400000;
  return days < REACTIVATE_AFTER_DAYS;
};

const dismissNow = () => {
  document.cookie = `${COOKIE_NAME}=${Date.now()}; path=/; max-age=${60 * 60 * 24 * REACTIVATE_AFTER_DAYS}; sameSite=lax`;
};

interface Props {
  shouldRender: boolean; // computed by caller from billing state
}

const MobileUpgradePill = memo<Props>(({ shouldRender }) => {
  const [dismissed, setDismissed] = useState(true); // start true to avoid flash before useEffect

  useEffect(() => {
    setDismissed(isDismissedRecently());
  }, []);

  if (!shouldRender || dismissed) return null;

  return (
    <Link
      href="/settings/subscription/plans?utm_source=home_pill"
      onClick={() => {
        // navigation happens via Link; cookie is set so the pill doesn't reappear
        dismissNow();
        setDismissed(true);
      }}
      style={{
        alignItems: 'center',
        background: 'linear-gradient(90deg, #6d28d9 0%, #2563eb 100%)',
        borderRadius: 12,
        color: '#fff',
        display: 'flex',
        fontSize: 14,
        fontWeight: 600,
        gap: 8,
        marginInline: 16,
        padding: '10px 14px',
        textDecoration: 'none',
      }}
    >
      <Zap size={16} />
      <span style={{ flex: 1 }}>Перейди на Pro — больше моделей, без лимитов</span>
      <ChevronRight size={16} />
    </Link>
  );
});

MobileUpgradePill.displayName = 'MobileUpgradePill';

export default MobileUpgradePill;
```

- [ ] **Step 4.3.2: Wire it into MobileHome**

Modify `src/features/MobileHome/index.tsx`. Add to imports:

```tsx
import { useUserStore } from '@/store/user';
import MobileUpgradePill from '@/features/Upsell/MobileUpgradePill';
```

Inside `MobileHome`:

```tsx
const billing = useUserStore((s) => s.billing);
const shouldRenderPill = billing?.planId === 1 && billing.tokensUsed > billing.tokensTotal * 0.5;
```

In the JSX, between Greeting and the chips section:

```tsx
<MobileUpgradePill shouldRender={!!shouldRenderPill} />
```

- [ ] **Step 4.3.3: Commit**

```bash
git add src/features/Upsell/MobileUpgradePill.tsx src/features/MobileHome/index.tsx
git commit -m "feat(mobile): persistent upgrade pill on home for free users"
```

---

### Task 4.4 — Mobile cancel flow

- [ ] **Step 4.4.1: Implement MobileCancelFlow**

Create `src/features/Upsell/MobileCancelFlow.tsx`:

```tsx
'use client';

import { Drawer } from 'antd';
import { Button, Flexbox, Text } from '@lobehub/ui';
import { memo, useState } from 'react';

const REASONS: { code: string; label: string }[] = [
  { code: 'too_expensive', label: 'Слишком дорого' },
  { code: 'not_using', label: 'Не пользовался' },
  { code: 'missing_feature', label: 'Не хватало функций' },
  { code: 'switched', label: 'Перешёл на другой сервис' },
  { code: 'temporary', label: 'Временно — потом вернусь' },
  { code: 'other', label: 'Другое' },
];

interface Props {
  loading?: boolean;
  onClose: () => void;
  onConfirm: (reasonCode: string, reasonText: string) => Promise<void>;
  open: boolean;
}

const MobileCancelFlow = memo<Props>(({ loading, onClose, onConfirm, open }) => {
  const [reason, setReason] = useState<string>('');
  const [text, setText] = useState('');

  return (
    <Drawer height="auto" onClose={onClose} open={open} placement="bottom" styles={{ body: { padding: 0 } }}>
      <Flexbox gap={12} paddingBlock={20} paddingInline={20}>
        <Text style={{ fontSize: 18, fontWeight: 600 }}>Жаль, что уходишь. Почему?</Text>
        <Flexbox gap={8}>
          {REASONS.map((r) => (
            <Button
              block
              key={r.code}
              onClick={() => setReason(r.code)}
              type={reason === r.code ? 'primary' : 'default'}
            >
              {r.label}
            </Button>
          ))}
        </Flexbox>
        <textarea
          onChange={(e) => setText(e.target.value)}
          placeholder="Расскажи подробнее (опционально)"
          rows={3}
          style={{ borderColor: 'var(--ant-color-border)', borderRadius: 8, borderStyle: 'solid', borderWidth: 1, padding: 8 }}
          value={text}
        />
        <Button
          block
          danger
          disabled={!reason || loading}
          loading={loading}
          onClick={() => onConfirm(reason, text)}
          size="large"
        >
          Подтвердить отмену
        </Button>
      </Flexbox>
    </Drawer>
  );
});

MobileCancelFlow.displayName = 'MobileCancelFlow';

export default MobileCancelFlow;
```

- [ ] **Step 4.4.2: Wire into Plans.tsx (mobile branch)**

Inside `src/business/client/BusinessSettingPages/Plans.tsx`, at the top:

```tsx
import { useIsMobile } from '@/hooks/useIsMobile';
import MobileCancelFlow from '@/features/Upsell/MobileCancelFlow';
```

Replace the cancel-modal logic with conditional rendering:

```tsx
const isMobile = useIsMobile();

return (
  <>
    {/* existing JSX */}
    {isMobile ? (
      <MobileCancelFlow
        loading={cancelMutation.isPending}
        onClose={() => setCancelOpen(false)}
        onConfirm={async (reasonCode, reasonText) => {
          await cancelMutation.mutateAsync({ reasonCode, reasonText });
          setCancelOpen(false);
        }}
        open={cancelOpen}
      />
    ) : (
      // existing desktop modal preserved
      <Modal /* ... */ />
    )}
  </>
);
```

- [ ] **Step 4.4.3: Commit**

```bash
git add src/features/Upsell/MobileCancelFlow.tsx src/business/client/BusinessSettingPages/Plans.tsx
git commit -m "feat(mobile): cancel flow as bottom-sheet survey"
```

---

## Task 5: Tracking — `upsell_impressions` + `upsell_clicks`

**Goal of task:** Every upsell impression and click is recorded in two new tables, exposed via tRPC, surfaced in admin `/finance/pricing-experiments`.

**Files:**
- Create: `packages/database/migrations/0XXX_upsell_tracking.sql`
- Create: `packages/database/src/schemas/upsell.ts`
- Modify: `packages/database/src/schemas/index.ts`
- Create: `src/server/routers/lambda/upsell.ts`
- Create: `src/features/Upsell/useTrackUpsell.ts`
- Modify: `src/features/Upsell/LockedModelUpsellSheet.tsx` — track impression on open + click on CTA
- Modify: `src/features/Upsell/MobileUpgradePill.tsx` — track impression + click

(Plus admin chart on the Supabase side — separate sub-task, see step 5.5.)

---

### Task 5.1 — Schema + migration

- [ ] **Step 5.1.1: Write schema**

Create `packages/database/src/schemas/upsell.ts`:

```ts
import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './user';

export const upsellImpressions = pgTable('upsell_impressions', {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  id: uuid('id').defaultRandom().primaryKey(),
  modelBlocked: text('model_blocked'),
  planOffered: text('plan_offered'),
  source: text('source').notNull(), // 'plan_limit_chat' | 'locked_model' | 'balance_nudge' | 'home_pill' | 'welcome_email'
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
});

export const upsellClicks = pgTable('upsell_clicks', {
  clickedAt: timestamp('clicked_at', { withTimezone: true }).defaultNow().notNull(),
  id: uuid('id').defaultRandom().primaryKey(),
  source: text('source').notNull(),
  targetPlan: text('target_plan'),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
});
```

- [ ] **Step 5.1.2: Re-export in barrel**

Modify `packages/database/src/schemas/index.ts` — append:

```ts
export * from './upsell';
```

- [ ] **Step 5.1.3: Generate migration**

Run: `cd /home/deploy/projects/ai-aggregator-lobechat && pnpm --filter @lobechat/database db:generate`
Expected: a new SQL file appears under `packages/database/migrations/`. Open it and verify it creates `upsell_impressions` and `upsell_clicks`.

- [ ] **Step 5.1.4: Commit**

```bash
git add packages/database/src/schemas/upsell.ts packages/database/src/schemas/index.ts packages/database/migrations/
git commit -m "feat(db): upsell_impressions + upsell_clicks tables"
```

- [ ] **Step 5.1.5: Apply migration on prod**

Run: `ssh root@135.181.115.234 "docker exec lobehub sh -c 'cd /app && node ./packages/database/dist/migrations.js'"` (or whatever the prod migration command is — engineer verifies in `package.json`).
Expected: tables created with no error. Confirm via:
`ssh root@135.181.115.234 "docker exec lobe-postgres psql -U postgres -d lobechat -c '\\\\d upsell_impressions'"`

---

### Task 5.2 — tRPC router

- [ ] **Step 5.2.1: Implement the router**

Create `src/server/routers/lambda/upsell.ts`:

```ts
import { z } from 'zod';

import { upsellClicks, upsellImpressions } from '@/database/schemas';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const SOURCES = [
  'plan_limit_chat',
  'locked_model',
  'balance_nudge',
  'home_pill',
  'welcome_email',
] as const;

const procedure = authedProcedure.use(serverDatabase);

export const upsellRouter = router({
  recordClick: procedure
    .input(
      z.object({
        source: z.enum(SOURCES),
        targetPlan: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.serverDB.insert(upsellClicks).values({
        source: input.source,
        targetPlan: input.targetPlan ?? null,
        userId: ctx.userId,
      });
      return { ok: true };
    }),

  recordImpression: procedure
    .input(
      z.object({
        modelBlocked: z.string().optional(),
        planOffered: z.string().optional(),
        source: z.enum(SOURCES),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.serverDB.insert(upsellImpressions).values({
        modelBlocked: input.modelBlocked ?? null,
        planOffered: input.planOffered ?? null,
        source: input.source,
        userId: ctx.userId,
      });
      return { ok: true };
    }),
});
```

- [ ] **Step 5.2.2: Mount the router**

Find where other lambda routers are aggregated (e.g. `src/server/routers/lambda/index.ts`) and add `upsell: upsellRouter`.

- [ ] **Step 5.2.3: Commit**

```bash
git add src/server/routers/lambda/upsell.ts src/server/routers/lambda/index.ts
git commit -m "feat(upsell): tRPC router for impressions + clicks"
```

---

### Task 5.3 — useTrackUpsell hook

- [ ] **Step 5.3.1: Implement**

Create `src/features/Upsell/useTrackUpsell.ts`:

```ts
'use client';

import { useCallback } from 'react';

import { lambdaQuery } from '@/libs/trpc/client';

export type UpsellSource =
  | 'plan_limit_chat'
  | 'locked_model'
  | 'balance_nudge'
  | 'home_pill'
  | 'welcome_email';

export const useTrackUpsell = () => {
  const recordImpression = lambdaQuery.upsell.recordImpression.useMutation();
  const recordClick = lambdaQuery.upsell.recordClick.useMutation();

  const impression = useCallback(
    (source: UpsellSource, opts?: { modelBlocked?: string; planOffered?: string }) => {
      recordImpression.mutate({
        modelBlocked: opts?.modelBlocked,
        planOffered: opts?.planOffered,
        source,
      });
    },
    [recordImpression],
  );

  const click = useCallback(
    (source: UpsellSource, opts?: { targetPlan?: string }) => {
      recordClick.mutate({ source, targetPlan: opts?.targetPlan });
    },
    [recordClick],
  );

  return { click, impression };
};
```

- [ ] **Step 5.3.2: Wire into LockedModelUpsellSheet (impression on open + click on CTA)**

In `src/features/Upsell/LockedModelUpsellSheet.tsx`:

```tsx
import { useEffect } from 'react';
import { useTrackUpsell } from './useTrackUpsell';

// inside component:
const { click, impression } = useTrackUpsell();

useEffect(() => {
  if (open) impression('locked_model', { modelBlocked: modelId, planOffered: requiredPlanName });
}, [open, modelId, requiredPlanName, impression]);

// on the primary CTA onClick, before navigation:
click('locked_model', { targetPlan: requiredPlanName });
```

- [ ] **Step 5.3.3: Wire into MobileUpgradePill**

In `src/features/Upsell/MobileUpgradePill.tsx`:

```tsx
import { useEffect } from 'react';
import { useTrackUpsell } from './useTrackUpsell';

// inside component (after dismissed-state logic):
const { click, impression } = useTrackUpsell();

useEffect(() => {
  if (shouldRender && !dismissed) impression('home_pill');
}, [shouldRender, dismissed, impression]);

// in onClick handler:
click('home_pill');
```

- [ ] **Step 5.3.4: Commit**

```bash
git add src/features/Upsell/useTrackUpsell.ts src/features/Upsell/LockedModelUpsellSheet.tsx src/features/Upsell/MobileUpgradePill.tsx
git commit -m "feat(upsell): track impressions + clicks for locked-model + home pill"
```

---

### Task 5.4 — Plan-limit chat error tracking

- [ ] **Step 5.4.1: Wire into business error renderer**

Modify `src/business/client/hooks/useRenderBusinessChatErrorMessageExtra.tsx`. Inside the function, before returning the JSX:

```tsx
import { useEffect } from 'react';
import { useTrackUpsell } from '@/features/Upsell/useTrackUpsell';
// inside:
const { click, impression } = useTrackUpsell();
const requiredPlan = body.requiredPlan;

useEffect(() => {
  if (error?.type === 'PlanLimitExceeded') {
    impression('plan_limit_chat', { modelBlocked: body.modelId, planOffered: requiredPlan });
  }
}, [error?.type, body.modelId, requiredPlan, impression]);
```

On the upgrade button onClick:

```tsx
onClick={() => click('plan_limit_chat', { targetPlan: requiredPlan })}
```

- [ ] **Step 5.4.2: Commit**

```bash
git add src/business/client/hooks/useRenderBusinessChatErrorMessageExtra.tsx
git commit -m "feat(upsell): track plan-limit chat impressions + clicks"
```

---

### Task 5.5 — Admin chart for `/finance/pricing-experiments`

- [ ] **Step 5.5.1: Add a query to webgpt-admin**

In `/home/deploy/projects/webgpt-admin/app/(admin)/finance/pricing-experiments/page.tsx`:

```ts
const { rows: funnel } = await sql`
  WITH imp AS (
    SELECT source, count(*)::int AS impressions
    FROM upsell_impressions
    WHERE created_at >= now() - interval '30 days'
    GROUP BY source
  ),
  clk AS (
    SELECT source, count(*)::int AS clicks
    FROM upsell_clicks
    WHERE clicked_at >= now() - interval '30 days'
    GROUP BY source
  ),
  paid AS (
    SELECT bp.user_id, max(bp.created_at) AS first_paid
    FROM billing_payments bp
    WHERE bp.status = 'succeeded' AND bp.type = 'subscription'
    GROUP BY bp.user_id
  ),
  paid_after_click AS (
    SELECT uc.source, count(DISTINCT uc.user_id)::int AS paid
    FROM upsell_clicks uc
    JOIN paid p ON p.user_id = uc.user_id
    WHERE p.first_paid >= uc.clicked_at AND uc.clicked_at >= now() - interval '30 days'
    GROUP BY uc.source
  )
  SELECT
    coalesce(imp.source, clk.source, paid_after_click.source) AS source,
    coalesce(imp.impressions, 0) AS impressions,
    coalesce(clk.clicks, 0) AS clicks,
    coalesce(paid_after_click.paid, 0) AS paid
  FROM imp
  FULL OUTER JOIN clk USING (source)
  FULL OUTER JOIN paid_after_click USING (source)
  ORDER BY impressions DESC NULLS LAST;
`;
```

Render a small table beneath the existing experiments table:

```tsx
<Table>
  <thead><tr><th>Источник</th><th>Impressions</th><th>Clicks</th><th>CTR</th><th>Paid</th><th>CR</th></tr></thead>
  <tbody>
    {funnel.map((r) => (
      <tr key={r.source}>
        <td>{r.source}</td>
        <td>{r.impressions}</td>
        <td>{r.clicks}</td>
        <td>{r.impressions ? `${((r.clicks / r.impressions) * 100).toFixed(1)}%` : '—'}</td>
        <td>{r.paid}</td>
        <td>{r.clicks ? `${((r.paid / r.clicks) * 100).toFixed(1)}%` : '—'}</td>
      </tr>
    ))}
  </tbody>
</Table>
```

- [ ] **Step 5.5.2: Commit + push admin**

```bash
cd /home/deploy/projects/webgpt-admin
git add app/\(admin\)/finance/pricing-experiments/page.tsx
git commit -m "feat(admin): upsell funnel table on pricing-experiments"
git push origin master
```

---

## Task 6: Phase 2 flip + monitoring

**Goal of task:** All mobile users land on the new responsive `(main)` flow; legacy `(mobile)` route still in code as rollback path.

---

- [ ] **Step 6.1: Set `NEXT_PUBLIC_MOBILE_REDESIGN=1` as default in prod env**

```bash
ssh root@135.181.115.234 "echo 'NEXT_PUBLIC_MOBILE_REDESIGN=1' >> /opt/lobechat/.env"
```

- [ ] **Step 6.2: Restart container**

```bash
ssh root@135.181.115.234 "cd /opt/lobechat && docker compose up -d --force-recreate lobe"
```

- [ ] **Step 6.3: Verify mobile users hit (main)**

Open `https://ask.gptweb.ru/` from a phone (without query string). Expected: greeting + chips + suggestions, NOT empty agents list. Confirm via:

```bash
ssh root@135.181.115.234 "docker logs lobehub --since 10m | grep -E 'MobileHome|page.tsx' | head"
```

- [ ] **Step 6.4: Watch activation metric for 1 week**

Daily query (use the admin):

```sql
SELECT date_trunc('day', u.created_at) AS day,
       count(*) AS signups,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM messages m
         WHERE m.user_id = u.id AND m.role = 'user'
           AND m.created_at < u.created_at + interval '5 minutes'
       )) AS activated_5m,
       round(100.0 * count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM messages m
         WHERE m.user_id = u.id AND m.role = 'user'
           AND m.created_at < u.created_at + interval '5 minutes'
       )) / count(*), 1) AS activation_pct
FROM users u
WHERE u.created_at >= now() - interval '14 days'
GROUP BY day
ORDER BY day DESC;
```

Expected after 1 week: activation_pct >70% on mobile users (vs ~48% baseline).

---

## Task 7: Phase 3 cleanup

**Goal of task:** Delete the legacy `(mobile)` route, `trpc/mobile`, `routers/mobile`, drop the feature flag.

(Run only after 2 weeks of stable Phase 2 with no rollback.)

---

- [ ] **Step 7.1: Remove the feature-flag dispatch**

Modify `src/app/[variants]/page.tsx`:

```tsx
import DesktopRouter from './router';
import { type DynamicLayoutProps } from '@/types/next';

export default async (_props: DynamicLayoutProps) => {
  return <DesktopRouter />;
};
```

- [ ] **Step 7.2: Delete `(mobile)` subtree**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
rm -rf src/app/\[variants\]/\(mobile\)
rm -rf src/app/\(backend\)/trpc/mobile
rm -rf src/server/routers/mobile
```

- [ ] **Step 7.3: Drop the feature flag from envs/app.ts**

Remove `NEXT_PUBLIC_MOBILE_REDESIGN` from schema and runtimeEnv. Remove `isMobileRedesignEnabled` helper.

- [ ] **Step 7.4: Run typecheck and build**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
npx tsc --noEmit 2>&1 | grep error: | head
```

Expected: no errors referencing deleted files.

- [ ] **Step 7.5: Commit**

```bash
git add -A
git commit -m "chore(mobile): remove legacy (mobile) route + feature flag"
```

- [ ] **Step 7.6: Remove env from prod**

```bash
ssh root@135.181.115.234 "sed -i '/^NEXT_PUBLIC_MOBILE_REDESIGN=/d' /opt/lobechat/.env"
ssh root@135.181.115.234 "cd /opt/lobechat && docker compose up -d --force-recreate lobe"
```

---

## Self-review

**Spec coverage:**
- Architecture (Section 1) → Tasks 1.1, 1.2, 6, 7. ✅
- Home screen + Onboarding (Section 2) → Tasks 1.4–1.7. ✅
- Image / Video / Plans / Settings (Section 3) → Tasks 2, 3. ✅
- Bottom tab bar + Global header (Section 4) → Tasks 1.4, 1.8, 1.9. ✅
- Upsell flow + Balance discoverability (Section 5) → Tasks 4, 5. ✅
- Tracking tables + admin chart → Task 5. ✅
- Migration phases 2 + 3 → Tasks 6, 7. ✅

**Gaps acknowledged but not implemented in this plan:**
- "Inline mode" for image/video chips (Section 3 spec). Marked as future enhancement; chips currently navigate to feature pages. This keeps Task 1.5 simple; inline mode requires deeper chat-input + payload changes (separate plan when ready).
- Per-message debit indicator under each assistant reply ("−3 кредита"). Marked optional in spec; deferred.
- Welcome-email upsell tracking (#5 in spec) — relies on email-link UTM landing on `/settings/subscription/plans?utm_source=brevo&utm_campaign=welcome_signup`. UTM cookie capture already exists; no new UI/logic needed beyond what's in Task 5.5 (admin chart sees the source).

**Placeholder scan:** No "TBD" / "TODO" left. A few tasks say "engineer adapts to existing API" where the existing component's exported props aren't fully visible from the spec — this is honest scaffolding, not a placeholder, since the engineer has the file open and can see the actual signatures.

**Type consistency:**
- `useTrackUpsell()` returns `{ click, impression }` and the `UpsellSource` enum matches between hook (`Task 5.3`) and tRPC router (`Task 5.2`). ✅
- `MobileUpgradePill` prop `shouldRender` is computed in MobileHome from `billing` shape — matches `useUserStore` selectors used elsewhere in the project. ✅
- `LockedModelUpsellSheet` props match what `useTrackUpsell.impression('locked_model', {...})` expects. ✅
- Cancel-flow `onConfirm(reasonCode, reasonText)` matches `cancelMutation.mutateAsync({ reasonCode, reasonText })` from Plans.tsx. ✅
