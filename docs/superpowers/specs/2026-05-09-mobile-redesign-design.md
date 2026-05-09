# Mobile Redesign — Design Spec

**Date:** 2026-05-09
**Author:** Pasha + Claude
**Status:** Approved (5 sections), pending user spec review → writing-plans

---

## Goal

Replace the current `(mobile)` route variant with a fully responsive `(main)` desktop experience that activates new mobile users (most signups), surfaces image/video/upsell features, and converts free → paid. Current mobile lands on an empty agents list with no chat input, no balance, no upsell, no image/video — most users churn within 2 minutes.

**Success metrics (90 days post-deploy):**
- First-message activation on mobile: **>70%** (baseline ~48% across all platforms)
- Mobile free→paid conversion: **>5%** (baseline 0%)
- Image/video usage on mobile: **>5% of monthly users try at least one** (baseline 0% — `usage_logs` for `kind='image'/'video'` had ZERO mobile entries)
- Day-1 mobile retention: **>30%** (baseline unknown, audit suggested very low)

---

## Architecture

**Drop the `(mobile)` route variant entirely. Make `(main)` responsive via the existing `useIsMobile()` hook.**

The `(mobile)` route is a rudimentary upstream-LobeChat shell missing every business feature we built (BalanceBadge, Plans, locked models, PlanLimitExceeded CTA, SuggestedPrompts auto-send, MobileTabBar with our items). Duplicating those into `(mobile)` doubles maintenance forever; making `(main)` responsive is one codebase, one source of truth.

### Migration in 3 phases

1. **Phase 1 — feature flag.**
   - Add `NEXT_PUBLIC_MOBILE_REDESIGN=1` env.
   - In `src/app/[variants]/page.tsx`, when flag is on, return `<DesktopRouter />` for everyone (mobile and desktop). When off, current behavior (`if (isMobile) return <MobileRouter />`).
   - Allow query-string override `?mobile_redesign=1` for prod-domain testing.
   - Verify on staging + a controlled cohort for 1 week.

2. **Phase 2 — flip default.**
   - `NEXT_PUBLIC_MOBILE_REDESIGN=1` becomes default in env. All mobile users hit `(main)` automatically.
   - `(mobile)` route still in code (rollback path) but unreachable.

3. **Phase 3 — cleanup (2 weeks after flip).**
   - Delete `src/app/[variants]/(mobile)/`, `src/app/(backend)/trpc/mobile/`, `src/server/routers/mobile/`.
   - ~20 files removed.
   - Drop the `NEXT_PUBLIC_MOBILE_REDESIGN` flag.

### Files

**Touched:**
- `src/app/[variants]/page.tsx` — feature-flag dispatcher.
- `src/app/[variants]/(main)/layout.tsx` — render mobile-aware sidebar/header.

**Kept (no change needed):**
- `src/hooks/useIsMobile.ts` — already works.
- `src/features/MobileTabBar/`, `src/features/MobileSwitchLoading/`, `src/features/ChatInput/Mobile/` — these are already used as reusable mobile-aware components, not tied to the route variant.
- `RouteVariants.deserializeVariants` — keep `isMobile` parsing for future variant flags.

**Risk:** mobile-side regression on a `(main)` page that was never tested at 375px width. Mitigation: feature flag + 1-week observation before flip.

**Risk:** bundle size — mobile users now load `(main)` which includes Agent/Pages/Search/Community/Admin. Mitigation: code-split those via `dynamic()` with `ssr: false`; on mobile they're behind a "Open full version on desktop" link, never executed.

---

## Home Screen + Onboarding

The mobile `/` (home) is the make-or-break activation surface. Layout below replaces the current empty agents list.

### Layout

```
┌───────────────────────────────┐
│ [WebGPT logo]  [50 кр💎] [👤]│ Header — sticky, 56px
├───────────────────────────────┤
│ 🔓 Бесплатный VPN →     [✕] │ VPN strip — dismissable
├───────────────────────────────┤
│   Привет, Влад! 👋            │
│   Чем тебе помочь?            │
│                               │
│  ┌─────────────────────────┐  │ INPUT — auto-focus on first visit only
│  │ Что нужно сделать? [➤] │  │
│  └─────────────────────────┘  │
│                               │
│  ─── Быстрые действия ───     │
│  [📷] [🎬] [🌐] [🔊]           │ FEATURE CHIPS — horizontal scroll
│   Карт Видео Перев TTS        │ tap = inline mode (chat-input switches)
│                               │
│  ─── Попробуй ───             │
│  ┌─────────────────────────┐  │ SUGGESTED PROMPTS — auto-send on tap
│  │ 💬 Объясни как работает │  │ (already shipped today)
│  │    нейросеть             │  │
│  └─────────────────────────┘  │
│  (2 more cards)               │
│                               │
├───────────────────────────────┤
│ 💬   📷   🎬   💎   👤       │ Tab bar — 56px
└───────────────────────────────┘
```

### Components

| Element | Component (existing or new) |
|---|---|
| Logo | `<HomeHeaderLogo>` — existing, mobile variant |
| Balance badge | `<BalanceBadge>` — existing on desktop, render in mobile header |
| Avatar dropdown | `<UserPanel>` — existing, reuse |
| Greeting | New `<MobileGreeting>` — reads `user.full_name` or email-prefix |
| Input | Existing `<ChatInputProvider>` + `<DesktopChatInput>` (responsive) or `<ChatInput/Mobile>` |
| Feature chips | New `<FeatureChipsRow>` — 4 chips, horizontal scroll, tap toggles inline mode |
| Suggested prompts | `<SuggestedPrompts>` — existing, click sends immediately (shipped today) |
| Tab bar | `<MobileTabBar>` — existing, fixed today (Image/Video/Plans always visible) |

### Onboarding

Light-touch, no product tour. The home screen handhold's enough:
- Greeting with first name
- Auto-focused input (first visit only, when `firstMessageSeen=false` AND `signup < 5 min ago` AND `viewport.height > 600` to avoid iOS keyboard race)
- Chips explaining what's possible
- 3 SuggestedPrompts with one-tap auto-send

Welcome-email via Brevo (already wired in `src/libs/better-auth/define-config.ts`) reinforces out-of-app. Diagnostic logs added today will surface delivery issues.

### Edge cases

- Returning user (`firstMessageSeen=true`): home shows recent topics list + quick input (already the desktop pattern).
- Free user taps a premium-locked chip: `BalanceBadge` highlights orange, PlanLimitExceeded sheet appears with upgrade CTA (already shipped today).

---

## Feature Pages (image / video / plans / settings) — Responsive

### `/image` mobile

Replace desktop split-pane with **stacked layout + sticky bottom generation panel**:

```
┌───────────────────────────────┐
│ [←] Создать картинку    [⋯]  │
├───────────────────────────────┤
│  History gallery (scroll)     │
│  [thumb] [thumb] [thumb]      │
├───────────────────────────────┤
│ Модель: Flux Schnell      ▼  │ Sticky bottom
│ Размер: [1:1] [16:9] [9:16]  │
│ ┌──────────────────────────┐  │
│ │ Опиши картинку...        │  │
│ └──────────────────────────┘  │
│ Цена: 1 кр       [Создать]   │
└───────────────────────────────┘
```

`<ImageWorkspace>` refactors into 2 layout variants — `<ImageWorkspaceDesktop>` (split) and `<ImageWorkspaceMobile>` (stacked). Shared `useImageGeneration()` hook holds business logic.

**Inline mode** (per chip from home): tap on `📷 Картинка` chip on home → chat input switches to image mode → user types prompt → result appears as assistant message with image attachment in the chat lane. Implemented via existing chat-stream image support; adapter converts user prompt to `payload.kind = 'image' + model + size`.

### `/video` mobile

Identical structure to `/image`. Generation is async (Wavespeed, 2-5 min):
- Submit → toast "Видео в работе. Уведомим когда готово 🎬"
- Job-row in history with progress placeholder
- Push notification via TG bot (existing `tg_bot_chat_id` in user_billing) on completion
- Free users: PlanGateBanner at top + Submit disabled (paid tier required for any video model).

### `/settings/subscription/plans` mobile

Cards stack vertically (vs side-by-side on desktop):

```
┌───────────────────────────────┐
│ Текущий: Старт (бесплатно)    │
│ Использовано: 12/50 кредитов  │
│ ████████░░░░░░░░░░░░░░░       │
├───────────────────────────────┤
│ ┌─────────────────────────┐   │
│ │ Базовый — 490 ₽/мес      │   │
│ │ • 1000 кр/мес            │   │
│ │ [Выбрать]                │   │
│ └─────────────────────────┘   │
│ ┌─────────────────────────┐   │
│ │ Pro 🔥 — 1490 ₽/мес       │   │ Highlighted
│ │ [Выбрать]                │   │
│ └─────────────────────────┘   │
│ ┌─────────────────────────┐   │
│ │ Pro Max — 2990 ₽/мес      │   │
│ │ [Выбрать]                │   │
│ └─────────────────────────┘   │
└───────────────────────────────┘
```

Tap "Выбрать" → YooKassa checkout → return to `/settings/billing?payment=success`. Already paid → "Управлять" link → cancel flow (bottom-sheet survey, 6 reasons + textarea, shipped today).

### `/settings/*` mobile

Sidebar becomes list-of-links:
- Профиль
- Подписка и тарифы
- Реферальная программа
- Персонализация
- Платежи
- Помощь
- "Открыть полную версию на компьютере" — link to desktop power-features (Agents/Pages/Community)
- Выйти

Sub-pages reuse existing desktop components with mobile padding adjustments.

### Files

| Create | Modify |
|---|---|
| `ImageWorkspaceMobile.tsx` | `ImageWorkspace.tsx` (split into two variants) |
| `VideoWorkspaceMobile.tsx` | `VideoWorkspace.tsx` |
| `PlansMobileLayout.tsx` (cards stack) | `PlansClient.tsx` |
| `MobileSettingsList.tsx` | `settings/_layout.tsx` |
| `useImageGeneration.ts` (shared hook) | |
| `useVideoGeneration.ts` (shared hook) | |

---

## Bottom Tab Bar + Global Header

### Tab bar — 5 tabs, fixed order

| # | Icon | Label | Route | Role |
|---|---|---|---|---|
| 1 | 💬 MessageSquare | Чат | `/` | main flow |
| 2 | 📷 ImageIcon | Картинки | `/image` | feature |
| 3 | 🎬 Video | Видео | `/video` | feature |
| 4 | 💎 Gem | Тарифы | `/settings/subscription/plans` | upsell |
| 5 | 👤 User | Профиль | `/settings` | settings + power-features |

Active tab determined by pathname prefix. Active = filled accent color, others outlined-grey. Labels truncate to 9 chars (existing TabBar behavior).

**Hide rules:**
- Open chat thread (`/chat/[topicId]`) — hide for vertical space.
- Full-screen image preview — hide.
- Settings sub-pages — keep visible (mobile users still navigate via tabs from there).

Implementation: `useShowTabBar()` hook reads pathname + modal state, returns boolean. `<MobileTabBar>` only renders when true. Existing `safeArea` prop handles iPhone home-indicator.

### Global Header

```
┌───────────────────────────────┐
│ [WebGPT]  50 кр💎     [👤]  │ 56px sticky
└───────────────────────────────┘
```

- **Left:** logo + "WebGPT" text → tap = home.
- **Center:** `<BalanceBadge>` — green normally, orange at <10%, red at <2%. Tap → `BalanceExplainSheet` (bottom-sheet with credit explanation + buy/upgrade CTAs).
- **Right:** avatar (24px) → bottom-sheet user menu (Профиль / Тарифы / Рефералы / Помощь / Выйти).

### VPN promo strip — fix overlap

Currently overlaps the header on mobile (visible in screenshot). Fix:
- Render BELOW header, not above.
- Make compact: "🔓 Бесплатный VPN →" (no long description).
- Dismissable via `vpn_promo_dismissed` cookie.
- Full-text version stays on desktop.

### Files

| Create | Modify |
|---|---|
| `useShowTabBar.ts` | `MobileTabBar/index.tsx` |
| `MobileGlobalHeader.tsx` | `BalanceBadge.tsx` (mobile context support) |
| `MobileVpnPromo.tsx` (compact + dismissable) | `VpnPromoStrip.tsx` (mobile variant) |
| `MobileUserMenu.tsx` (bottom-sheet) | |
| `BalanceExplainSheet.tsx` | |

---

## Upsell Flow + Balance Discoverability

Five upsell touchpoints to lift free→paid from 0% mobile to >5%.

### 1. PlanLimitExceeded inline CTA — ✅ shipped 2026-05-09

When user picks a premium model and submits, chat shows an inline `<Block>` with the human-readable reason + "Перейти на тариф {required}" button → `/settings/subscription/plans`. Mobile gets this for free via responsive Block + Button. Backend wraps the 403 in `createErrorResponse(ChatErrorType.PlanLimitExceeded, {currentPlan, modelId, requiredPlan, errorMessage})`.

### 2. Locked-model bottom-sheet upsell

Model-switcher locked icon → tap = bottom-sheet (not floating dialog) with:
- Plan that unlocks it
- Model description
- Price
- "Перейти на Pro за X ₽/мес" button
- "Сравнить тарифы" link → plans page

Existing on desktop as tooltip/modal; mobile re-renders as bottom-sheet via `useIsMobile`.

### 3. Balance nudge at <10% remaining

`BalanceBadge` turns red + subtle pulse (0.5s × 3) when `tokens_used_month >= total * 0.9`. Tap → bottom-sheet:
- "У вас осталось 4 кредита. Купить ещё или перейти на тариф?"
- "+100 кредитов за 99 ₽" (top-up via `/settings/billing`)
- "Тарифы" → `/settings/subscription/plans`

At 0 credits: chat input is disabled with sticky CTA "Кредиты исчерпаны → Тарифы".

### 4. Persistent upgrade pill on home (free users only)

Renders above input when `plan_id=1 AND tokens_used_month > total*0.5`:

```
┌───────────────────────────────┐
│ ⚡ Перейди на Pro — больше    │ accent gradient
│   моделей, без лимитов  →    │ tap → /plans
└───────────────────────────────┘
```

Dismissable for 7 days via cookie. If user hasn't tapped Тарифы tab in 7 days, pill reactivates.

### 5. Welcome-email upsell

Already in the welcome-email template (shipped earlier): "Если бесплатных кредитов не хватит, тарифы начинаются от 490 ₽" + CTA → `/settings/subscription/plans?utm_source=brevo&utm_campaign=welcome_signup`. UTM tracking in place.

### Cancel flow on mobile

For paid users on the plans page, banner "Подписка истечёт DD.MM.YYYY" + "Управлять подпиской":
- Tap → bottom-sheet with "Продлить" (YooKassa) and "Отменить"
- "Отменить" → bottom-sheet survey (6 reason codes + textarea) — already implemented in `Plans.tsx`
- Confirm → toast "Подписка активна до DD.MM.YYYY" + DB write to `cancellation_surveys` + `billing_subscription_events.cancelled` (both already wired today)

### Balance discoverability — first-tap explainer

On first BalanceBadge tap (cookie `balance_explained_seen=false`):

```
1 кредит ≈ 1 короткое сообщение GPT-5-mini
5 кредитов = 1 картинка Flux
50 кредитов = 1 картинка Nano Banana Pro
200 кредитов = 1 минута видео Seedance

У вас 50 бесплатных кредитов в месяц.
Они обновятся 1 июня 2026.

[Купить ещё] [Перейти на Pro]
```

After first dismiss, accessible via "?" icon next to the number.

Optional: per-message debit indicator under each assistant reply ("−3 кредита") in chat lane. Mobile-only first; consider for desktop later.

### Tracking conversion

Add tables/columns to track funnel:
- `upsell_impressions(user_id, source, model_blocked, plan_offered, shown_at)` — written when any of the 5 CTAs renders
- `upsell_clicks(user_id, source, target_plan, clicked_at)` — written on CTA click

Admin `/finance/pricing-experiments` (currently near-empty) gets a chart "impression → click → paid" per source. Replaces guesswork with measured truth.

### Files (upsell)

| Create | Modify |
|---|---|
| `BalanceExplainSheet.tsx` | `BalanceBadge.tsx` |
| `MobileUpgradePill.tsx` | `Plans.tsx` (responsive cards) |
| `LockedModelUpsellSheet.tsx` | `LockedModelTooltip.tsx` (mobile = bottom-sheet) |
| `MobileCancelFlow.tsx` | `Plans.tsx` cancel modal (bottom-sheet variant) |
| migration: `upsell_impressions`, `upsell_clicks` | |
| `useTrackUpsell()` hook (writes both tables) | |

---

## Out of scope

- **Native iOS / Android apps.** Web-only redesign.
- **Push notifications API** beyond TG bot (which is in-place). Web Push for Safari/Chrome — separate spec.
- **Email-verification workflow.** `AUTH_EMAIL_VERIFICATION=1` toggle is a separate decision (driven by ghost-account/bot signup concerns) — addressed in its own spec.
- **Pro mode on mobile.** Killed by Q5 decision; Agents/Pages/Search/Community/Admin remain desktop-only via "Open full version" link.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Mobile regression on a `(main)` page | Medium | Feature-flagged Phase 1, 1-week observation |
| Bundle size for mobile users grows | Low-Medium | Code-split desktop-only features via `dynamic()` |
| iOS Safari bottom-sheet UX issues (50vh, scroll lock) | Medium | Use `@lobehub/ui` Drawer or Antd Drawer with `placement="bottom"` and `height="auto"` — existing well-tested patterns |
| YooKassa checkout flow on mobile webview | Low | Already works on desktop; same redirect → return URL pattern |
| Free users miss the upgrade pill (banner blindness) | Medium | Track impressions + clicks via tables 4-5; iterate on copy/placement after 30 days of data |

## Implementation order

(Steps 1-5 happen inside migration Phase 1 — feature flag on, behind `?mobile_redesign=1` query. Step 6 = Phase 2 flip. Step 7 = Phase 3 cleanup.)

1. **Step 1 — Plumbing.** Feature flag + responsive home screen layout + bottom-tab-bar fix. Header with BalanceBadge.
2. **Step 2 — Feature pages.** `/image` + `/video` responsive workspaces (mobile stacked layout).
3. **Step 3 — Plans + settings.** `/settings/subscription/plans` mobile cards stack + `/settings` mobile list-of-links.
4. **Step 4 — Upsell touchpoints.** Locked-model bottom-sheet, balance nudge, persistent upgrade pill, cancel-flow as bottom-sheet.
5. **Step 5 — Tracking.** `upsell_impressions` + `upsell_clicks` tables, `useTrackUpsell()` hook, admin pricing-experiments chart.
6. **Step 6 — Migration Phase 2 flip.** `NEXT_PUBLIC_MOBILE_REDESIGN=1` becomes default. All mobile users hit the new flow. Monitor activation metric for 1 week.
7. **Step 7 — Migration Phase 3 cleanup.** Remove `(mobile)` route, `trpc/mobile`, `routers/mobile`. Drop the feature flag.

Each step is a separable PR. Step 1 alone delivers >70% of the activation lift; steps 4-5 capture conversion. Step 6 is the risk gate; Step 7 is debt cleanup.
