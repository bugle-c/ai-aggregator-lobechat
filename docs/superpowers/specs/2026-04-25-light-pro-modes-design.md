# Light / Pro modes for WebGPT — Design Spec

**Date:** 2026-04-25
**Status:** Approved (awaiting user spec review)
**Replaces:** Task 1.2 build-time `NEXT_PUBLIC_SIMPLE_UI` flag (will be reverted)

## Goal

Two UI/UX modes per user, switchable at runtime via a prominent toggle. Same backend functionality in both — only what the user sees differs.

- **Light** — minimal interface for casual users. 5 sidebar items. Only the `lobehub` (WebGPT) provider visible. Locked models shown with upgrade prompts. Custom model addition / API-key fields hidden.
- **Pro** — full LobeChat experience. All providers visible (including user's own API-keyed ones). Plugins, advanced model parameters, agent market, all settings — everything.

## Why

Activation baseline = **6.5%** (3 of 46 April users sent any message). Hypothesis: LobeChat's power-user UI is the bottleneck. New users need a focused first impression with one clear path: chat → image → video → upgrade. Power users still want all the toys — Pro mode keeps them.

## Architecture

### Data model

Extend existing `user_onboarding` table:

```sql
ALTER TABLE user_onboarding
  ADD COLUMN ui_mode varchar(8) NOT NULL DEFAULT 'light'
  CHECK (ui_mode IN ('light','pro'));
```

Backfill all existing rows to `'light'` per business decision (every existing user gets the simplified first impression; they can switch to Pro themselves).

### Server-side

Add to existing `userOnboarding` tRPC router (already exists from Task 1.3):

- `getOnboardingState()` — extend response to include `ui_mode`
- `setUiMode(mode: 'light' | 'pro')` — new mutation, updates the column, returns new state

No changes to chat route, billing, or any aggregator core. Pure user-preference plumbing.

### Client-side

**Store slice** (Zustand or extension of existing user-state): `uiMode: 'light' | 'pro'`. Loaded on app boot via `getOnboardingState`. Optimistic update on toggle click.

**Selector wrappers** in `src/store/aiInfra/slices/aiProvider/selectors.ts`:

```ts
const lightModeProviderFilter = (s: AIProviderStoreState) =>
  s.aiProviderList.filter((p) => p.id === 'lobehub');

const enabledAiProviderListByUiMode = (s: AIProviderStoreState, uiMode: UiMode) =>
  uiMode === 'light' ? lightModeProviderFilter(s) : enabledAiProviderList(s);
```

Same wrapping pattern for `enabledImageModelList` and `enabledVideoModelList`.

**Sidebar visibility:** hard-coded allowlist when `uiMode === 'light'` — only items with id ∈ {'chat','image','video','pricing','settings'} render.

**Settings menu visibility:** allowlist when `uiMode === 'light'` — only items with id ∈ {'profile','stats','common','chat-appearance','subscription','hotkey','about'} render.

**Provider settings page** (`/settings/provider`) — wrap with redirect: if `uiMode === 'light'`, redirect to `/settings/profile` (the Provider page is gated behind Pro).

**Custom model addition** — checked at component level: any "Add new model" button reads `uiMode` from store and conditionally renders.

### Toggle component

`<UIModeToggle />` — segmented control, \~140px wide, in top-bar right (next to BalanceBadge from Task 1.3).

```
[ ✨ Light │ ⚙️ Pro ]
   active     inactive
```

Click on inactive segment:

1. Fire `setUiMode` mutation
2. Optimistic local-state update
3. If switching Light → Pro: toast "Включён Pro режим. Доступны все провайдеры и продвинутые настройки."
4. If switching Pro → Light AND the currently-selected chat model is from a non-lobehub provider: reset to default `lobehub` model + toast "Модель переключена на WebGPT — другие провайдеры скрыты в Light режиме"

No full page reload required — state-driven re-render handles sidebar, selector, settings menu visibility.

**Mobile:** segmented control collapses to icon-only `[ ✨ │ ⚙️ ]` at <600px viewport.

### Locked-model UX

When user is on a plan that doesn't allow a model (e.g. free user looking at Claude Opus):

- Model card in selector renders with `🔒` icon prefix and slightly muted color (60% opacity)
- Click on locked model → `<UpsellModal />` opens
- Modal contents:
  - Header: "Модель «{displayName}» доступна в плане {requiredPlan}"
  - Body: short feature comparison or "{requiredPlan} даёт доступ к {N} моделям, включая Claude Opus, GPT-5.2, Imagen Ultra"
  - CTAs: `[ Перейти на {requiredPlan} — {price} ₽/мес ]` (primary, links to /settings/subscription/plans) and `[ Закрыть ]` (secondary)

Required plan computed via existing `getRequiredPlanForModelAsync` from `model-tiers.ts` (already implemented).

Same UX in Pro mode (it's just plan-gating that always existed) — but in Pro the lock icon is more informational than promotional. Same component, same logic.

### Welcome modal copy update (Task 1.3 amendment)

Existing `<WelcomeModal />` body string updated (Russian):

> # Добро пожаловать в WebGPT!
>
> У вас 20 бесплатных кредитов. Этого хватит на \~40 простых вопросов к ChatGPT.
>
> Вы в **Light режиме** — самом простом интерфейсе. Хотите подключить свои API-ключи или открыть продвинутые настройки — нажмите **Pro** в правом верхнем углу.
>
> \[ Начать ]

## What Light mode hides (concrete list)

### Sidebar (left navigation)

Hidden: Discover, Pages, Memory, Resource (Files), Workspace tabs, Agent Market, Plugins, Community.

Visible: 💬 Чат, 🎨 Картинки, 🎬 Видео, 💎 Тарифы, ⚙️ Настройки.

### Settings page sidebar

Hidden: Provider, Apikey, Proxy, Storage, SystemTools, Agent, Skill (plugins), TTS, Image, Memory, Security (already partially gated).

Visible: Profile, Stats, Common, ChatAppearance, Subscription, Hotkey, About, Sign out.

### Chat model selector

Filter: only models from provider `id === 'lobehub'` rendered. All other providers (anthropic, openai, google, xai, deepseek, openrouter, etc., even if user has them enabled with their own API keys) are hidden in selector dropdown.

### Image / Video pages

Same provider filter — only `lobehub` image/video models in their selectors. Pages themselves (`/image`, `/video`) render upstream as-is.

### "Add custom model" / "Add provider"

Any component that lets the user introduce a non-WebGPT model or provider is hidden in Light. This includes: custom model row in any provider's settings, the "+" button to register a new provider, the API-key input fields.

## What Pro mode shows

Everything that LobeChat upstream + our customizations show today. No additional changes — just absence of the Light filter. The user sees:

- All enabled providers (lobehub + whatever they've configured personally)
- Real model IDs (gpt-5-mini, claude-sonnet-4-6, etc.)
- Full settings menu
- Plugins, market, advanced parameters, persona/agent config
- Custom model addition, API-key fields, proxy config, storage controls

## Migration plan

1. Apply DB migration (next available number, likely `0091_user_onboarding_ui_mode.sql`).
2. Backfill `UPDATE user_onboarding SET ui_mode='light';` (no-op for new rows, only affects existing).
3. Revert Task 1.2's `NEXT_PUBLIC_SIMPLE_UI` build flag — Dockerfile, `/opt/lobechat/.env`, `src/config/featureFlags/schema.ts` field, sidebar components' conditional rendering. The build-time flag is replaced entirely by runtime per-user `ui_mode`.
4. Build + deploy.

## Acceptance criteria

| #   | Criterion                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------- |
| 1   | New user registers → `user_onboarding.ui_mode='light'`                                               |
| 2   | All pre-existing `user_onboarding` rows updated to `ui_mode='light'`                                 |
| 3   | Light sidebar shows exactly 5 items: Чат / Картинки / Видео / Тарифы / Настройки                     |
| 4   | Light chat model selector shows only lobehub provider's models                                       |
| 5   | Light Image and Video pages show only lobehub models                                                 |
| 6   | Locked models in Light render with 🔒 and click opens UpsellModal with correct required-plan + price |
| 7   | Toggle in top-bar visible, clickable, persists across reload                                         |
| 8   | Switching Light → Pro: full UI returns within same session, no reload                                |
| 9   | Switching Pro → Light while on non-lobehub model: model resets to default lobehub + toast            |
| 10  | Settings page in Light: 8 items as listed                                                            |
| 11  | `NEXT_PUBLIC_SIMPLE_UI` build-flag fully removed (Dockerfile + code + .env)                          |
| 12  | Welcome modal copy updated to mention Pro toggle                                                     |
| 13  | Build + deploy succeeds; aggregator container boots; `/webapi/health` 200                            |

## Out of scope (NOT in this spec)

- Image/Video pages content simplification (`option A` in brainstorming — leave upstream pages as-is, may revisit if telemetry shows confusion)
- Conversion-focused upsell variants beyond the basic locked-model modal (referral program, A/B test of pricing — those are Phase 2 of the growth plan)
- Plan-tier badge/banners outside the model selector (some tier-gated indicator might be desired in sidebar — defer until we see usage data)
- Migrating chat history / agents / personas with mode change — they all belong to the user regardless of mode

## Risks

1. **Existing power users (\~few) auto-migrated to Light** may briefly think providers are gone. Mitigation: prominent toggle in top-bar — they'll find it within seconds. Onboarding toast on Light landing for first time after migration: "Вы в Light режиме. Pro доступен в правом верхнем углу."
2. **Toggle click must be fast** — sluggish state update (>500ms) destroys the "see-it-respond" feel. The mutation is fire-and-forget on the optimistic-update path; UI updates locally first.
3. **Dependency on Task 1.3 onboarding state table** — already deployed, foundation is solid.
4. **DB migration** — straightforward ALTER TABLE; tested via Drizzle journal in same way as 0090.

## Decision log (from brainstorming dialogue, 2026-04-25)

- Toggle approach: per-user runtime DB flag, NOT build-time env (replaces NEXT_PUBLIC_SIMPLE_UI from Task 1.2)
- Existing users default: `light` (everyone gets the new experience; opt back to Pro)
- Sidebar in Light: include separate `Тарифы` item (option B in conversation)
- /image and /video pages: as-is from upstream, no extra simplification (option A)
- Plan-locked models in Light: shown with lock + upsell modal (option B), not hidden (option A)
- Settings in Light: 8 items — Profile, Stats, Common, ChatAppearance, Subscription, Hotkey, About, Sign out (option B)
- Toggle component: segmented control `[ ✨ Light │ ⚙️ Pro ]` (option A)
- Light/Pro differ ONLY in UI/UX, NEVER in functionality (key constraint from user)
