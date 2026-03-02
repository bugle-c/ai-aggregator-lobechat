# WebGPT UX Simplification Design

## Problem

1. **Plans are hidden** — tariffs are buried in Settings → Subscription → Plans. Users don't know they exist.
2. **Model picker is overwhelming** — shows all models from all providers with technical details (tokens, context, abilities). Regular users get confused by dozens of models they don't understand.

## Solution

Two changes: prominent Plans button in sidebar + simplified model picker with recommended models.

---

## 1. Plans Button in Sidebar

### Location

Bottom area of the left icon sidebar, next to Settings gear icon. New icon button (CreditCard or Star icon) labeled "Тарифы".

```
+--+---------------------------+
|  | Chat content              |
|💬| (chats)                   |
|🤖| (agents)                  |
|  |                           |
|  |                           |
|--|                           |
|⭐| ← Plans (new button)     |
|⚙️| ← Settings (existing)    |
|👤| ← Profile (existing)     |
+--+---------------------------+
```

### Behavior

- Click → navigates to `/settings/plans` (reuses existing Plans.tsx page)
- Opens full-screen plans page with plan comparison, top-up packages, current balance
- Same content as Settings → Plans, but accessible in 1 click

### Implementation

- Add icon button to sidebar footer (NavPanel component)
- Route to existing `/settings/plans` page
- Only shown when `enableBusinessFeatures = true`

---

## 2. Simplified Model Picker

### Current State

ModelSwitchPanel opens a resizable panel showing ALL enabled models from ALL providers. Virtual scrolling, search, grouping by model/provider. Too complex for regular users.

### New Design

Add a "Recommended" section at the top of the model list. By default, only recommended models are visible. Full list available via "All models" button.

```
+----------------------------------+
| 🔍 Search model...              |
|----------------------------------|
| ⭐ Recommended                   |
|                                  |
| GPT-4o                          |
| Smart & fast — for most tasks    |
|                                  |
| Claude Sonnet                    |
| Best for writing and analysis    |
|                                  |
| GPT-4o mini                     |
| Fastest — simple questions       |
|                                  |
| o1                               |
| Deep analysis — math, code      |
|                                  |
|----------------------------------|
| 📋 All models (23) →            |
+----------------------------------+
```

### Recommended Models Config

New constant in business config:

```typescript
const RECOMMENDED_MODELS = [
  {
    modelId: 'gpt-4o',
    description: 'Умный и быстрый — для большинства задач',
    order: 1,
  },
  {
    modelId: 'claude-sonnet-4-20250514',
    description: 'Лучший для текстов и анализа',
    order: 2,
  },
  {
    modelId: 'gpt-4o-mini',
    description: 'Самый быстрый — простые вопросы',
    order: 3,
  },
  {
    modelId: 'o1',
    description: 'Глубокий анализ — математика, код',
    order: 4,
  },
];
```

### Behavior

1. When ModelSwitchPanel opens, recommended models appear first with descriptions
2. Below recommended section — "All models (N)" button
3. Clicking "All models" expands full model list (existing behavior)
4. Search works across both recommended and all models
5. Recommended models show Russian descriptions instead of technical details
6. If user selects a non-recommended model, it's remembered per agent

### Implementation

- Modify `useBuildListItems` hook to inject recommended section at top
- Add new `RecommendedModelItem` renderer with description text
- Add "Show all" / "Show recommended" toggle state
- Config stored in `src/const/recommended-models.ts`
- Only active when `enableBusinessFeatures = true`

---

## 3. Files to Modify

### Plans Button

- `src/features/NavPanel/SideBarLayout.tsx` — add Plans icon button to footer
- `src/locales/default/subscription.ts` — add sidebar button label

### Model Picker

- `src/const/recommended-models.ts` — NEW: recommended models config
- `src/features/ModelSwitchPanel/hooks/useBuildListItems.ts` — inject recommended section
- `src/features/ModelSwitchPanel/components/List/ListItemRenderer.tsx` — new recommended item renderer
- `src/features/ModelSwitchPanel/components/PanelContent.tsx` — toggle state for show all/recommended
