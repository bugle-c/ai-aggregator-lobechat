# Magic-5min Sprint 2 — Magic Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]` checkboxes. READ the spec (`docs/superpowers/specs/2026-07-06-magic-5min-onboarding-design.md`, «Спринт 2») first.

**Goal:** The P0 Magic Flow: intent chips instead of the welcome modal → charged input → follow-up chips → earned free image inline in the chat → recap + TG hook → contextual paywall. Wow-budget (b): \~15 bonus credits/user, monthly cap alerting.

**Architecture (from the scout map, verified):** WelcomeModal is modified in place (gating `first_login_seen` stays). New DB columns via hand-written migration 0107 (+ journal entry — pattern of 0092/0105; boot-applies via `scripts/migrateServerDB/docker.cjs`). Free grant reuses the proven idempotent bonus pattern of `grant-tg-link-bonus.ts` — bonus credits already flow through image precharge (`chargeBeforeGenerate.ts` includes `activeBonusFor`), and failed generations already refund the hold. Inline image = standard chain `generationTopic.createTopic → image.createImage → generationBatch.getGenerationBatches (for asyncTaskId!) → poll generation.getGenerationStatus`. Events = Yandex Metrika `reachGoal` (counter 106801684; there are currently ZERO goals in code).

**Pre-flight done:** `google/nano-banana-2/text-to-image` exists in `ai_aggregator.model_rates` with `pricing_unit='image'`, per_unit $0.07, active, no tier restriction.

**Verification gate per task:** `npx next build --webpack` exit 0. Branch `feat/magic-sprint2` off canary. No merge/push until final task.

**Scope deviations (agreed):** backup scenario chips under the input are NOT added — `HomeChips` already serves that role. `funnel_events` table deferred; Metrika goals only (M1 measurement is funnel-in-Metrika).

---

### Task 1: DB foundation — intent column, magic-bonus grant, tRPC

**Files:**

- Modify: `packages/database/src/schemas/userOnboarding.ts` (add `intent: text('intent')`)
- Modify: the user_billing schema file (find via `grep -rn "tgBonusClaimedAt\|tg_bonus_claimed_at" packages/database/src/schemas/`) — add `magicBonusClaimedAt: timestamp('magic_bonus_claimed_at')`
- Create: `packages/database/migrations/0107_magic_flow.sql`:

```sql
ALTER TABLE "user_onboarding" ADD COLUMN "intent" text;
ALTER TABLE "user_billing" ADD COLUMN "magic_bonus_claimed_at" timestamp with time zone;
```

- Modify: `packages/database/migrations/meta/_journal.json` — append `{ "idx": 107, "version": "7", "when": <ts after the idx-105 entry>, "tag": "0107_magic_flow", "breakpoints": true }` (NOTE: 0106 is intentionally absent from journal — go after 105's `when`).

- Create: `src/server/modules/billing/grant-magic-images-bonus.ts` — copy the idempotent pattern of `src/server/modules/billing/grant-tg-link-bonus.ts` verbatim, changed to: +15 bonus credits, expiry +7 days, stamp `magicBonusClaimedAt`, `setWhere: magic_bonus_claimed_at IS NULL`.

- Modify: `src/business/server/lambda-routers/userOnboarding.ts` — two procedures modeled on `setUiMode`:
  - `setIntent` (input `{ intent: z.enum(['post','doc','essay','ask']) }`) → upsert user_onboarding.intent.
  - `claimMagicBonus` (no input) → SERVER GATE: count user's messages (`messages` table, role='user', content length ≥ 10) — if `< 2` return `{ granted: false, reason: 'not_yet' }`; else call `grantMagicImagesBonus`; return `{ granted, alreadyClaimed }`. Find the messages table/model import used elsewhere in server routers.

- Also: export `STORAGE_KEY` (rename export `INTENT_PROMPT_STORAGE_KEY`) from `src/app/[variants]/(main)/home/features/InputArea/useIntentPrompt.ts` AND set `sessionStorage.setItem('webgpt_intent_prompt_consumed','1')` in its inject phase (race fix: WelcomeModal renders after an async query, by which time the key may already be consumed).

- [ ] Steps: schema edits → migration file → journal entry → grant module → router procedures → `npx eslint` changed files → build gate → apply the SQL to prod DB manually too (`docker exec lobe-postgres psql -U postgres -d lobechat -f -` with the two ALTERs; boot-migrate will then no-op) → commit `feat(magic): intent column + magic-images bonus grant + onboarding procedures`.

### Task 2: Intent screen «Что делаем?» in WelcomeModal

**Files:**

- Create: `src/features/Onboarding/IntentChips.tsx`
- Modify: `src/features/Onboarding/WelcomeModal.tsx` (replace body lines \~59–86; KEEP: gating, markFirstLoginSeen, TG-bonus block 88–133)
- Create: `src/business/client/analytics/ym.ts`:

```ts
export const reachGoal = (goal: string, params?: Record<string, unknown>) => {
  try {
    (window as any).ym?.(106_801_684, 'reachGoal', goal, params);
  } catch {
    /* noop */
  }
};
```

**IntentChips behavior:** four chips (grid 2×2):

| id    | label                           | template prefilled into the editor                                                         |
| ----- | ------------------------------- | ------------------------------------------------------------------------------------------ |
| post  | 📣 Пост и картинка для соцсетей | «Напиши продающий пост для ВК: {услуга}, {акция}, {срок} — живым языком, с эмодзи»         |
| doc   | 📄 Договор / претензия / письмо | «Составь {документ} для {ситуация} — со ссылками на законы РФ, деловым языком»             |
| essay | 🎓 Эссе / объяснить тему        | «Напиши эссе на тему {тема} по критериям ЕГЭ, а потом перепиши как обычный старшеклассник» |
| ask   | 💬 Просто спросить              | (no template — just close)                                                                 |

On click: `reachGoal('chip_click', {intent})` → `setIntent.mutate({intent})` (fire-and-forget) → close modal (existing handleClose) → prefill the editor with the template via the exact pattern of `useIntentPrompt` inject phase (`useChatStore.getState().mainInputEditor` → `setDocument('markdown', …)` + `setState({inputMessage})` + focus; poll a few frames if editor not yet mounted).

**Skip logic:** in WelcomeModal, before rendering, `if (sessionStorage.getItem(INTENT_PROMPT_STORAGE_KEY) || sessionStorage.getItem('webgpt_intent_prompt_consumed')) { markFirstLoginSeen (background); return null; }` — a blog-intent user already has a charged input; don't interrupt.
Also fire `reachGoal('prompt_prefill')` inside `useIntentPrompt` on successful inject.

Modal title becomes «Что делаем?», subtitle «35 бесплатных кредитов уже на счету — выберите задачу». TG-bonus block stays below the chips.

- [ ] Steps: ym helper → IntentChips → WelcomeModal surgery → eslint → build gate → commit `feat(magic): intent chips screen replaces welcome modal body`.

### Task 3: Earned magic — inline free image in chat

**Files:**

- Create: `src/business/client/MagicImage/MagicImageExtra.tsx` (+ small `useMagicImage.ts` hook next to it)
- Modify: `src/features/Conversation/Messages/Assistant/Extra/index.tsx` — render `<MagicImageExtra id={id} content={content} />` after existing extras.

**Gating (client, cheap):** render nothing unless ALL:

1. message id === `displayMessageSelectors.lastDisplayMessageId` (chat store; reexported from `src/store/chat/selectors`);
2. user messages in active topic ≥ 2 (`displayMessageSelectors.activeDisplayMessages(s).filter(m => m.role==='user' && m.content.trim().length >= 10).length >= 2`);
3. onboarding cohort: `userOnboarding.getOnboardingState` has `intent` set (returned by getOnboardingState — extend its select if needed) AND local state not already completed.

**Flow on button «🎨 Сделать картинку к этому — бесплатно»:**

1. `reachGoal('earned_magic_unlock')`; call `claimMagicBonus` — if `{granted:false, reason:'not_yet'}` hide; proceed if granted or alreadyClaimed (bonus may still be active).
2. Build image prompt from conversation: take last assistant message content (the `content` prop), truncate \~400 chars, wrap: `Иллюстрация к тексту: <content>. Яркая, современная, фотореалистичная, без текста и надписей на изображении`.
3. `lambdaClient.generationTopic.createTopic()` → returns topic id; `lambdaClient.image.createImage({ generationTopicId, imageNum: 1, model: 'google/nano-banana-2/text-to-image', provider: 'lobehub', params: { prompt } })`.
4. GOTCHA: response generations have `asyncTaskId: null` — call `lambdaClient.generationBatch.getGenerationBatches({topicId})` to obtain the real asyncTaskId/generationId.
5. Poll `generationService.getGenerationStatus(generationId, asyncTaskId)` (client wrapper `src/services/generation.ts`) every 3s up to 120s. On success: `reachGoal('first_image')`, render `<img>` inline (rounded, maxWidth 360) + recap line «За {N} минут: текст + картинка. У дизайнера это \~1500₽» + two buttons: «Скачать» (a href download) and «Продолжить в Telegram» (`https://t.me/gptwebrubot`, `reachGoal('magic_complete')`). On failure: quiet error text «Не получилось сгенерировать — кредиты не списаны» (refund is automatic via chargeAfterGenerate).
6. While generating: skeleton + «Рисуем картинку… \~20 секунд».
7. `doc` intent branch: instead of the image button show «📋 Скопировать документ» (copies `content` to clipboard, antd message success) — same gating.

**Anti-abuse note (server-side is authoritative):** the grant itself is the gate (claimMagicBonus checks N≥2 server-side, one-shot per user); the image charge rides normal billing against the bonus — no bypass paths.

- [ ] Steps: hook + component → mount in Extra → eslint → build gate → commit `feat(magic): earned free image inline in chat with recap and TG hook`.

### Task 4: Contextual paywall + return-to-chat

**Files:**

- Modify: `src/components/CreditsExhaustedModal/CreditsExhaustedModal.tsx` — new optional props `contextNote?: string; returnPath?: string`; render contextNote at top (secondary text); pass returnPath into both createPayment mutations' input.

- Modify: `src/features/Conversation/ChatInput/index.tsx` (\~126–131, 227) — compute `returnPath = \`/agent/${agentId}?topic=${activeTopicId}\``(inbox agent included; grab ids from existing store context in that file) and`contextNote = 'Ваш диалог сохранён — после оплаты вы вернётесь ровно сюда'`; pass to the modal; fire `reachGoal('paywall_view')\` when opening.

- Modify: `src/business/server/lambda-routers/topUp.ts` (\~47) and `subscription.ts` (\~60) — optional `returnPath: z.string().regex(/^\/(agent|home)/).max(200).optional()` in createPayment input; when present build return_url as `APP_URL + returnPath + (existing mandatory params appended as extra query)`. CRITICAL: subscription must KEEP `recoveryFor=<paymentId>` param (recovery flow depends on it) — append `&recoveryFor=...` to the custom path. topUp keeps `payment=success`.

- [ ] Steps: routers first → modal → ChatInput wiring → eslint → build gate → commit `feat(billing): contextual paywall returns the payer to the same chat`.

### Task 5: Merge, deploy, verify

- [ ] Final `npx next build --webpack` exit 0 on the branch; `git checkout canary && git merge --ff-only feat/magic-sprint2 && git push origin canary`.
- [ ] Apply migration SQL to prod manually (Task 1 note) BEFORE the container restarts, so old code never sees missing columns and new code finds them ready.
- [ ] Monitor restart; smoke: `getOnboardingState` returns intent field; `claimMagicBonus` as fresh user → `not_yet`.
- [ ] Headless: welcome modal shows «Что делаем?» chips (fresh anon can't see it — verify via logged-in owner OR screenshot of component states); `?prompt=` visit skips modal.
- [ ] Metrika: goals появляются в счётчике 106801684 (создать 6 целей в интерфейсе Метрики руками — оператор).
- [ ] Journal + memory update.
