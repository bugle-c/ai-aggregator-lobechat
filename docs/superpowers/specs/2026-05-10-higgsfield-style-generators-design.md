# Higgsfield-style Generator Pages — Design

**Status:** draft (awaiting user approval)
**Author/owner:** Pavel
**Scope:** Redesign `/image` and `/video` from the current "workspace + topic sidebar + config sidebar" layout to a higgsfield-flow-style preset-driven layout. Desktop and mobile.

## Goal

Replace the current "топорный" generator pages with a discovery-first preset gallery wrapped around a persistent prompt/config sidebar. Users land on a visual gallery of looping-MP4 preset cards, pick a style, refine the prompt, and generate — same flow `higgsfield.ai/ai/video?select=preset` ships, adapted to our model lineup and credit/billing layer.

## Non-goals

- No new "Create hub" page above `/image` and `/video`. Existing tab-bar entries continue to point straight at each modality.
- No user-saved presets in v1 (only curator-managed library).
- No admin UI for preset management in v1 (SQL seeding via migration; admin UI is phase 2).
- No automated MP4 pre-generation pipeline in v1 (admin generates and uploads manually; automation is phase 2).
- TopicSidebar (chat-like history grouping) is removed entirely.

## Architecture

```
┌──────────────────────── /image  /video ────────────────────────┐
│                                                                 │
│  DESKTOP                                                        │
│  ┌────────────────┬─────────────────────────────────────────┐  │
│  │ FlowSidebar    │ MainArea                                │  │
│  │ (~320px fixed) │                                         │  │
│  │                │ [Tabs: Стили | Мои генерации]           │  │
│  │ • PresetThumb  │                                         │  │
│  │ • ImageUpload? │ ── СТИЛИ ──                             │  │
│  │ • PromptInput  │   [ModelTabs: Flux|Nano|Veo|Sora|…]     │  │
│  │ • EnhanceTog.  │   [CategoryTabs: Все|Новые|Trending|…]  │  │
│  │ • ModelSelect  │   [Search 🔍]                            │  │
│  │ • GenerateBtn  │   [PresetGrid 4-col masonry MP4 loops]  │  │
│  │ • CreditBadge  │                                         │  │
│  │                │ ── МОИ ГЕНЕРАЦИИ ──                     │  │
│  │                │   [GenerationFeed: cards latest first]  │  │
│  └────────────────┴─────────────────────────────────────────┘  │
│                                                                 │
│  MOBILE                                                         │
│  ┌──────────────────────────────────────┐                       │
│  │ MobileGlobalHeader                   │                       │
│  │ [Tabs: Стили | Мои генерации]        │                       │
│  │                                      │                       │
│  │  ── СТИЛИ ──                         │                       │
│  │  ModelTabs (h-scroll)                │                       │
│  │  CategoryTabs (h-scroll)             │                       │
│  │  [Grid 2-col masonry MP4]            │                       │
│  │                                      │                       │
│  │  ── МОИ ГЕНЕРАЦИИ ──                 │                       │
│  │  Feed cards                          │                       │
│  │                                      │                       │
│  │            [FAB: Создать ✦] ←────── opens MobileFlowSheet   │
│  └──────────────────────────────────────┘                       │
│                                                                 │
│  MobileFlowSheet (bottom-sheet) =                               │
│    same content as desktop FlowSidebar                          │
│    + "Выбрать стиль" button → opens preset picker modal         │
└─────────────────────────────────────────────────────────────────┘
```

### Component decomposition

Each unit has one responsibility, communicates via props or store, can be tested in isolation.

| Component               | Responsibility                                                      | Inputs                                       | Where it lives                                                      |
| ----------------------- | ------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------- |
| `FlowSidebar` (desktop) | Persistent left panel with prompt/config/Generate                   | `modality`, store-driven preset+model+prompt | `(main)/<modality>/_layout/FlowSidebar/`                            |
| `MobileFlowSheet`       | Bottom-sheet equivalent of FlowSidebar                              | same                                         | `(main)/<modality>/features/MobileFlowSheet/`                       |
| `PresetThumbCard`       | Currently selected preset preview in sidebar                        | `preset` (or null)                           | shared `features/Generators/PresetThumbCard.tsx`                    |
| `PresetGallery`         | Grid of preset cards with model+category tabs + search              | `modality`                                   | shared `features/Generators/PresetGallery/`                         |
| `PresetCard`            | One preset tile (looping MP4, badges, title)                        | `preset`                                     | shared `features/Generators/PresetGallery/PresetCard.tsx`           |
| `PresetMP4Player`       | MP4 lazy-load + autoplay/loop/mute, hover-on-desktop, tap-on-mobile | `previewUrl`                                 | shared                                                              |
| `ModelTabs`             | Top tabs by model                                                   | `modality`, `selected`                       | shared (per-modality model list comes from existing model registry) |
| `CategoryTabs`          | Sub-tabs by category                                                | `modality`, `model`, `selected`              | shared                                                              |
| `GenerationFeed`        | Existing feed reused, just dropped into a tab                       | as today                                     | reuse existing `(main)/<modality>/features/GenerationFeed/`         |
| `MobileFlowFAB`         | Floating "Создать ✦" button on mobile that opens MobileFlowSheet    | —                                            | `(main)/<modality>/features/MobileFlowFAB.tsx`                      |

### Routing

- `/image` and `/video` keep the same paths.
- Internal state (active tab, active preset, model, category filter, search query) is **URL-synced** via search params:
  - `?tab=presets|feed`
  - `?model=<slug>`
  - `?category=<slug>`
  - `?preset=<preset-slug>` (deep-link to a specific preset)
  - `?q=<search>`
- Default tab logic: `presets` if user has zero generations on this modality, `feed` otherwise. Override via `?tab=`.

### Data model

New table `presets`:

```sql
CREATE TABLE presets (
  id            BIGSERIAL PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,           -- url-safe id, e.g. 'crash-zoom-in'
  modality      TEXT NOT NULL CHECK (modality IN ('image','video')),
  model_id      TEXT NOT NULL,                  -- references existing model registry slug
  category      TEXT NOT NULL,                  -- 'camera' | 'effects' | … (free-form, validated app-side)
  title         TEXT NOT NULL,                  -- displayed under thumbnail
  description   TEXT,                            -- optional one-liner caption
  prompt_template TEXT NOT NULL,                 -- supports `{{user_prompt}}` placeholder
  params_lock   JSONB NOT NULL DEFAULT '{}',    -- e.g. { aspect_ratio: '16:9', steps: 30 }
  preview_url   TEXT NOT NULL,                  -- RustFS-hosted MP4 (loops 3–6 sec)
  badges        TEXT[] NOT NULL DEFAULT '{}',   -- subset of {top_choice, mixed, new, trending}
  sort_order    INT NOT NULL DEFAULT 0,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX presets_modality_model_idx ON presets (modality, model_id, category, sort_order)
  WHERE active = TRUE;
```

Seed data shipped in a Drizzle migration: 10–12 video presets across 4 categories, 10–12 image presets across 5 categories. Slugs and prompt templates copied from a curated reference list (genre templates from the OSideMedia higgsfield-skill repo as inspiration; preview MP4s authored manually before launch).

### Behaviour

**Picking a preset:**

1. User taps a card in PresetGallery.
2. Store action `selectPreset(preset)`:
   - sets `currentPreset` in modality store
   - applies `model_id` (overrides current model selection)
   - merges `params_lock` over user-set params (lock wins; params not in lock remain user-controlled)
   - leaves user's prompt textarea untouched (NOT auto-prefilled — see below)
3. Sidebar's `PresetThumbCard` updates to show the new preset thumbnail + name. A small ✕ next to it clears the selection (back to "no preset").
4. URL `?preset=<slug>` updated.

**Why prompt is NOT auto-prefilled:** higgsfield's `prompt_template` typically wraps the user prompt rather than replacing it (`"crash zoom into {{user_prompt}}"`). On generate, the backend renders the template with the user's typed prompt. This keeps the UX honest — the textarea always reflects what the user typed; the preset adds style around it.

**Generating with no preset:** user types prompt and clicks Generate. We use whatever model is currently in the model selector and no params lock. Standard "freestyle" flow.

**Search:** client-side filtering of currently loaded presets by title (and maybe description). No fuzzy search in v1.

**Badges:** `top_choice` shows yellow corner badge, `new` shows red dot in corner, `mixed` shows gray label bottom-right, `trending` shows fire emoji. Badge data comes from `presets.badges` array.

**Mobile FAB position:** bottom-right, 16px above tab-bar (so it doesn't fight the tab-bar). FAB is hidden when MobileFlowSheet is open.

### Empty state vs filled state

- "Empty" = the modality store has zero generations for this user. Default `tab=presets`. The "Мои генерации" tab is still clickable but renders an EmptyFeed component ("Здесь появятся ваши генерации, как только вы создадите первую").
- "Filled" = at least one generation. Default `tab=feed` on first navigation; if URL has `?tab=presets` we honor it.
- The FlowSidebar (desktop) and MobileFlowSheet (mobile) are present in BOTH states; they don't change based on whether feed is empty.

### Tracking

Reuse existing `useTrackUpsell` infrastructure for analytics. New events:

- `preset_view` — fires once per preset card when it scrolls into viewport (IntersectionObserver, debounce)
- `preset_apply` — fires when user picks a preset
- `preset_generate` — fires when generation succeeds with a preset applied (joinable to billing)

This lets us see which presets actually convert. Stored in existing upsell tables with a `source = 'preset_<slug>'` distinguisher (or a separate table — decide in plan phase).

### Mobile-specific decisions

- Two-column masonry grid for preset cards (one column = \~50% viewport). Looping MP4s play once on scroll-into-view, then pause; tap card → fullscreen modal with bigger preview + "Применить" CTA.
- MobileFlowSheet opens at 80vh height by default; drag-down to dismiss.
- "Назад" button (chat header pattern) on the modality top header navigates to `/`. Same pattern as we already added to chat thread header.

### Right-config-panel (existing today)

Removed. All settings move into FlowSidebar (desktop) / MobileFlowSheet (mobile). The 280px space saved on the right goes to a wider preset gallery.

### Phase 1 vs phase 2

**Phase 1 (this spec):**

- Schema + 10–12 seed presets per modality
- FlowSidebar + PresetGallery + PresetCard + PresetMP4Player components
- Tab system (Стили / Мои генерации)
- Mobile FAB + MobileFlowSheet
- Manual preview MP4 upload to RustFS (admin runs script, hard-codes URLs in seed migration)
- URL-synced state
- Tracking events

**Phase 2 (later, separate spec):**

- Admin UI under `/admin/presets` for CRUD on presets
- Automated preview MP4 pre-generation cron (using our own model providers; result uploaded to RustFS automatically)
- User-saved personal presets ("⭐ сохранить")
- "Mixed" presets (combine multiple style locks)
- Server-rendered SEO preview for `?preset=<slug>` deep-links

### Migration plan

1. Build new components alongside existing workspace.
2. Behind `?new_flow=1` query param at first → smoke test internally.
3. Flip default for everyone in one commit when smoke-test passes.
4. Delete old `ImageWorkspace`, `VideoWorkspace`, `TopicSidebar`, right-side ConfigPanel, EmptyState (redundant) in a follow-up cleanup commit. Keep PromptInput / GenerationFeed (reused).

### Out of scope of this redesign

- Existing model registry (we just consume it; no changes).
- Billing/credits (preset-applied generations charge same as freestyle generations).
- Topic-grouping resurrection (TopicSidebar gone for good).
- Onboarding tour pointing at presets (deferred — natural discoverability is the point).

### Risks / open questions

- **MP4 hosting cost & latency:** RustFS already runs; bandwidth bill grows with preset adoption. Mitigation: lazy-load (only when card scrolls into view), set short max-age cache, use poster image (still frame) as fallback.
- **Preview pipeline manual in phase 1:** admin must generate \~25 MP4s by hand before launch. Acceptable for v1 but is a launch-blocker if not started early.
- **Preset → model coupling:** if we ever deprecate a model, all its presets break. Mitigation: `presets.active = false` on model deprecation; admin can replace.
- **Search localization:** preset titles ship in Russian. If we later need English, add `title_en` column. Not solved in v1.
- **Mobile FAB collision with bottom tab-bar:** position above the bar. Drag-aware bottom-sheet handles its own iOS safe area.

---

## Approval checklist

- [ ] Goal & non-goals
- [ ] Architecture / component decomposition
- [ ] Data model
- [ ] Behaviour (preset apply, generate, no-preset path)
- [ ] Mobile-specific decisions
- [ ] Phase 1 vs phase 2 split
- [ ] Migration plan
- [ ] Risks understood

When all checked → invoke `superpowers:writing-plans` for the implementation plan.
