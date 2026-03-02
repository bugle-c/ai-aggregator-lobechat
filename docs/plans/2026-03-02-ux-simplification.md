# UX Simplification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a prominent "Plans" button in the sidebar navigation and simplify the model picker with a recommended models section.

**Architecture:** Two independent changes. (1) Add a Plans nav item to the sidebar icon panel (Nav.tsx) that navigates to `/settings/plans`. (2) Modify the ModelSwitchPanel to show a "Recommended" section at the top with 3-5 curated models with Russian descriptions, and a "Show all" toggle to reveal the full list.

**Tech Stack:** React 19, TypeScript, @lobehub/ui, react-i18next, react-router-dom, zustand, Virtuoso (virtual list)

---

## Task 1: Add Plans icon to sidebar navigation

**Files:**

- Modify: `src/app/[variants]/(main)/home/_layout/Header/components/Nav.tsx`
- Modify: `src/locales/default/subscription.ts` (add sidebar label key)

**Context:**

- `Nav.tsx` renders the vertical icon bar with items: Search, Home, Pages, Video, Image, Community, Admin
- Each item has: `icon`, `key`, `title`, `url`, optional `hidden` and `isNew`
- `hidden` controls visibility via feature flag
- Items render as `<Link>` with `<NavItem>` inside
- Plans page already exists at route `/settings/plans`
- Only show when `enableBusinessFeatures = true` (already available in this component)

**Step 1: Add i18n key for sidebar plans button**

In `src/locales/default/subscription.ts`, add to the existing object:

```typescript
sidebar: {
  plans: 'Тарифы',
},
```

**Step 2: Add Plans item to Nav.tsx**

In `src/app/[variants]/(main)/home/_layout/Header/components/Nav.tsx`:

1. Add import at top:

```typescript
import { CreditCard } from 'lucide-react';
```

2. Add `useTranslation('subscription')` alongside existing `useTranslation('common')`:

```typescript
const { t: tSub } = useTranslation('subscription');
```

3. Add Plans item to the `items` array, right before the Admin item:

```typescript
{
  hidden: !enableBusinessFeatures,
  icon: CreditCard,
  key: 'plans',
  title: tSub('sidebar.plans'),
  url: '/settings/plans',
},
```

**Step 3: Verify**

Run: `PATH="/home/deploy/.bun/bin:$PATH" bun run build 2>&1 | tail -20`
Expected: Build succeeds (only pre-existing webgpt-agents.ts errors)

**Step 4: Commit**

```bash
git add src/app/[variants]/(main)/home/_layout/Header/components/Nav.tsx src/locales/default/subscription.ts
git commit -m "✨ feat(nav): add Plans button to sidebar navigation"
```

---

## Task 2: Create recommended models config

**Files:**

- Create: `src/const/recommended-models.ts`

**Context:**

- This config defines which models appear in the "Recommended" section of the model picker
- Each entry has a `modelId` (must match the model's `id` in the provider system), a Russian `description`, and `order`
- The `modelId` values must match what's configured in the LobeHub provider

**Step 1: Create the config file**

Create `src/const/recommended-models.ts`:

```typescript
export interface RecommendedModel {
  description: string;
  modelId: string;
  order: number;
}

export const RECOMMENDED_MODELS: RecommendedModel[] = [
  {
    description: 'Умный и быстрый — для большинства задач',
    modelId: 'gpt-4o',
    order: 1,
  },
  {
    description: 'Лучший для текстов и анализа',
    modelId: 'claude-sonnet-4-20250514',
    order: 2,
  },
  {
    description: 'Самый быстрый — простые вопросы',
    modelId: 'gpt-4o-mini',
    order: 3,
  },
  {
    description: 'Глубокий анализ — математика, код',
    modelId: 'o1',
    order: 4,
  },
];
```

**Step 2: Commit**

```bash
git add src/const/recommended-models.ts
git commit -m "✨ feat(models): add recommended models config"
```

---

## Task 3: Add recommended-header list item type

**Files:**

- Modify: `src/features/ModelSwitchPanel/types.ts`

**Context:**

- `types.ts` defines the `ListItem` discriminated union used by the virtual list
- We need two new item types: `recommended-header` (section title) and `recommended-model` (model with description)
- The `ListItem` union currently has: `model-item-single`, `model-item-multiple`, `group-header`, `provider-model-item`, `empty-model`, `no-provider`

**Step 1: Add new types to ListItem union**

In `src/features/ModelSwitchPanel/types.ts`, add these two new entries to the `ListItem` type union (after the existing entries, before the semicolon):

```typescript
| {
    description: string;
    model: AiModelForSelect;
    providerId: string;
    type: 'recommended-model';
  }
| {
    type: 'recommended-header';
  }
| {
    count: number;
    type: 'show-all-toggle';
  }
```

**Step 2: Add recommended item height to const.ts**

In `src/features/ModelSwitchPanel/const.ts`, add to `ITEM_HEIGHT`:

```typescript
'recommended-header': 32,
'recommended-model': 52,
'show-all-toggle': 40,
```

**Step 3: Commit**

```bash
git add src/features/ModelSwitchPanel/types.ts src/features/ModelSwitchPanel/const.ts
git commit -m "✨ feat(models): add recommended model list item types"
```

---

## Task 4: Inject recommended models into list

**Files:**

- Modify: `src/features/ModelSwitchPanel/hooks/useBuildListItems.ts`

**Context:**

- `useBuildListItems` takes `enabledList` (all providers+models), `groupMode`, and `searchKeyword`
- Returns `ListItem[]` for the Virtuoso virtual list
- We need to inject recommended models at the TOP of the list (before regular items)
- Only inject when `searchKeyword` is empty (searching should show all matches)
- Need to match recommended model IDs against enabled models to get the full model data
- Add a `showAll` parameter to control whether full list is shown

**Step 1: Add showAll parameter and recommended injection**

Modify the function signature to accept `showAll: boolean`:

```typescript
export const useBuildListItems = (
  enabledList: EnabledProviderWithModels[],
  groupMode: GroupMode,
  searchKeyword: string = '',
  showAll: boolean = false,
): ListItem[] => {
```

At the beginning of the `useMemo` callback, before the existing logic, add recommended model injection:

```typescript
import { RECOMMENDED_MODELS } from '@/const/recommended-models';
```

Inside useMemo, after the `enabledList.length === 0` check, add:

```typescript
// Build recommended items when not searching
const recommendedItems: ListItem[] = [];
if (!searchKeyword.trim()) {
  const recommendedHeader: ListItem = { type: 'recommended-header' };
  recommendedItems.push(recommendedHeader);

  for (const rec of RECOMMENDED_MODELS) {
    // Find this model in enabled providers
    for (const provider of enabledList) {
      const found = provider.children.find((m) => m.id === rec.modelId);
      if (found) {
        recommendedItems.push({
          description: rec.description,
          model: found,
          providerId: provider.id,
          type: 'recommended-model',
        });
        break; // Use first matching provider (lobehub first due to sorting)
      }
    }
  }

  // Only show recommended section if we found at least one model
  if (recommendedItems.length <= 1) {
    recommendedItems.length = 0;
  }
}
```

Then, before the final return of each branch (`byModel` and `byProvider`), prepend:

For `byModel` branch, change the return to:

```typescript
const regularItems = modelArray
  .sort((a, b) => a.displayName.localeCompare(b.displayName))
  .map((data) => ({
    data,
    type:
      data.providers.length === 1
        ? ('model-item-single' as const)
        : ('model-item-multiple' as const),
  }));

if (!showAll && recommendedItems.length > 0) {
  return [...recommendedItems, { count: regularItems.length, type: 'show-all-toggle' as const }];
}

return [...recommendedItems, ...regularItems];
```

For `byProvider` branch, change the return to:

```typescript
if (!showAll && recommendedItems.length > 0) {
  return [...recommendedItems, { count: items.length, type: 'show-all-toggle' as const }];
}

return [...recommendedItems, ...items];
```

Add `showAll` to the useMemo dependency array.

**Step 2: Commit**

```bash
git add src/features/ModelSwitchPanel/hooks/useBuildListItems.ts
git commit -m "✨ feat(models): inject recommended models into list builder"
```

---

## Task 5: Add showAll state to PanelContent and List

**Files:**

- Modify: `src/features/ModelSwitchPanel/components/PanelContent.tsx`
- Modify: `src/features/ModelSwitchPanel/components/List/index.tsx`

**Context:**

- `PanelContent` manages state (searchKeyword, groupMode) and passes to `List`
- `List` calls `useBuildListItems` and renders via Virtuoso
- We need `showAll` state in PanelContent, passed to List, then to `useBuildListItems`

**Step 1: Add showAll state to PanelContent**

In `src/features/ModelSwitchPanel/components/PanelContent.tsx`:

Add state:

```typescript
const [showAll, setShowAll] = useState(false);
```

Pass to List:

```typescript
<List
  extraControls={extraControls}
  groupMode={groupMode}
  model={modelProp}
  provider={providerProp}
  searchKeyword={searchKeyword}
  showAll={showAll}
  onModelChange={onModelChangeProp}
  onOpenChange={onOpenChange}
  onToggleShowAll={() => setShowAll((prev) => !prev)}
/>
```

**Step 2: Accept props in List**

In `src/features/ModelSwitchPanel/components/List/index.tsx`:

Add to `ListProps` interface:

```typescript
showAll?: boolean;
onToggleShowAll?: () => void;
```

Destructure in component:

```typescript
showAll = false,
onToggleShowAll,
```

Pass `showAll` to `useBuildListItems`:

```typescript
const listItems = useBuildListItems(enabledList, groupMode, searchKeyword, showAll);
```

Pass `onToggleShowAll` to `ListItemRenderer`:

```typescript
<ListItemRenderer
  activeKey={activeKey}
  extraControls={extraControls}
  isScrolling={isScrolling}
  item={item}
  newLabel={newLabel}
  onClose={handleClose}
  onModelChange={handleModelChange}
  onToggleShowAll={onToggleShowAll}
/>
```

**Step 3: Commit**

```bash
git add src/features/ModelSwitchPanel/components/PanelContent.tsx src/features/ModelSwitchPanel/components/List/index.tsx
git commit -m "✨ feat(models): wire showAll state through panel components"
```

---

## Task 6: Render recommended items in ListItemRenderer

**Files:**

- Modify: `src/features/ModelSwitchPanel/components/List/ListItemRenderer.tsx`
- Modify: `src/locales/default/subscription.ts` (add i18n keys)

**Context:**

- `ListItemRenderer` renders different item types via a switch statement
- We need to handle 3 new cases: `recommended-header`, `recommended-model`, `show-all-toggle`
- Recommended model items should show model name + description text
- Show-all-toggle is a clickable item showing "All models (N)"

**Step 1: Add i18n keys**

In `src/locales/default/subscription.ts`, add:

```typescript
modelPicker: {
  recommended: 'Рекомендованные',
  showAll: 'Все модели',
},
```

**Step 2: Add props and cases to ListItemRenderer**

In `src/features/ModelSwitchPanel/components/List/ListItemRenderer.tsx`:

Add to `ListItemRendererProps`:

```typescript
onToggleShowAll?: () => void;
```

Add import:

```typescript
import { ChevronDown, Star } from 'lucide-react';
```

Add new cases in the switch statement (before `default`):

```typescript
case 'recommended-header': {
  return (
    <Flexbox
      horizontal
      align="center"
      gap={6}
      key="recommended-header"
      paddingBlock={'8px 4px'}
      paddingInline={12}
      style={{ color: cssVar.colorTextSecondary }}
    >
      <Icon icon={Star} size={14} />
      <span style={{ fontSize: 12, fontWeight: 600 }}>
        {t('ModelSwitchPanel.recommended', { ns: 'subscription' })}
      </span>
    </Flexbox>
  );
}

case 'recommended-model': {
  const key = menuKey(item.providerId, item.model.id);
  const isActive = key === activeKey;

  return (
    <Flexbox style={{ marginBlock: 1, marginInline: 4 }}>
      <Block
        clickable
        className={cx(menuSharedStyles.item, isActive && styles.menuItemActive)}
        gap={2}
        style={{ paddingBlock: 6, paddingInline: 8 }}
        variant={'borderless'}
        onClick={async () => {
          onModelChange(item.model.id, item.providerId);
          onClose();
        }}
      >
        <ModelItemRender
          {...item.model}
          {...item.model.abilities}
          showInfoTag
          newBadgeLabel={newLabel}
        />
        <span
          style={{
            color: cssVar.colorTextTertiary,
            fontSize: 11,
            lineHeight: '14px',
            paddingInlineStart: 2,
          }}
        >
          {item.description}
        </span>
      </Block>
    </Flexbox>
  );
}

case 'show-all-toggle': {
  return (
    <Flexbox style={{ marginBlock: 1, marginInline: 4 }}>
      <Block
        clickable
        horizontal
        className={styles.menuItem}
        gap={6}
        style={{ color: cssVar.colorTextSecondary, justifyContent: 'center' }}
        variant={'borderless'}
        onClick={() => onToggleShowAll?.()}
      >
        <span style={{ fontSize: 12 }}>
          {t('ModelSwitchPanel.showAll', { ns: 'subscription' })} ({item.count})
        </span>
        <Icon icon={ChevronDown} size={14} />
      </Block>
    </Flexbox>
  );
}
```

**Step 3: Verify build**

Run: `PATH="/home/deploy/.bun/bin:$PATH" bun run build 2>&1 | tail -20`
Expected: Build succeeds (only pre-existing webgpt-agents.ts errors)

**Step 4: Commit**

```bash
git add src/features/ModelSwitchPanel/components/List/ListItemRenderer.tsx src/locales/default/subscription.ts
git commit -m "✨ feat(models): render recommended models and show-all toggle"
```

---

## Task 7: Build verification and manual testing

**Files:** None (verification only)

**Step 1: Full build**

```bash
PATH="/home/deploy/.bun/bin:$PATH" bun run build 2>&1 | tail -30
```

Expected: Build passes with only pre-existing webgpt-agents.ts errors.

**Step 2: Check for type errors in changed files**

```bash
PATH="/home/deploy/.bun/bin:$PATH" bunx tsc --noEmit --pretty 2>&1 | grep -E "(recommended-models|useBuildListItems|ListItemRenderer|PanelContent|Nav\.tsx)" | head -20
```

Expected: No errors in our files.

**Step 3: Verify i18n keys**

Check that all new i18n keys are properly defined:

```bash
grep -n "sidebar\|modelPicker" src/locales/default/subscription.ts
```

Expected: Shows `sidebar.plans`, `modelPicker.recommended`, `modelPicker.showAll` keys.
