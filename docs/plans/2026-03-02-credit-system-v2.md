# Credit System v2 — Per-Model Pricing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace flat-rate credits with per-model token-based billing, fix credit deduction after chat, unify providers through OpenRouter.

**Architecture:** Each model has input/output token rates in a config file. After each chat stream completes, actual token usage is extracted from the response and converted to credits using model-specific rates. All AI traffic routes through OpenRouter as single provider.

**Tech Stack:** TypeScript, tRPC, Drizzle ORM, PostgreSQL, OpenRouter API, react-i18next

---

### Task 1: Create model rates config

**Files:**
- Create: `src/server/modules/billing/model-rates.ts`
- Modify: `src/server/modules/billing/constants.ts`

**Step 1: Create model rates config file**

Create `src/server/modules/billing/model-rates.ts`:

```typescript
// Per-model API pricing (USD per 1M tokens)
// Source: OpenRouter/Anthropic/OpenAI official pricing, March 2026
export interface ModelRate {
  inputPer1M: number;   // USD per 1M input tokens
  outputPer1M: number;  // USD per 1M output tokens
}

// Default rate for unknown models (Claude Sonnet pricing as safe middle)
export const DEFAULT_MODEL_RATE: ModelRate = { inputPer1M: 3.0, outputPer1M: 15.0 };

// 1 credit ≈ 0.20₽ selling price
// MARKUP: sell at 1.33x API cost (≈75% cost-to-revenue)
export const CREDIT_VALUE_RUB = 0.15;  // API cost per 1 credit in RUB
export const USD_TO_RUB = 100;

export const MODEL_RATES: Record<string, ModelRate> = {
  // Cheap tier (~1 credit/msg)
  'deepseek-chat':              { inputPer1M: 0.32, outputPer1M: 0.89 },
  'deepseek/deepseek-chat':     { inputPer1M: 0.32, outputPer1M: 0.89 },
  'gpt-5-mini':                 { inputPer1M: 0.25, outputPer1M: 2.00 },
  'openai/gpt-5-mini':          { inputPer1M: 0.25, outputPer1M: 2.00 },
  'gpt-5-nano':                 { inputPer1M: 0.10, outputPer1M: 0.40 },
  'openai/gpt-5-nano':          { inputPer1M: 0.10, outputPer1M: 0.40 },

  // Mid tier (~2-4 credits/msg)
  'gemini-3-flash-preview':             { inputPer1M: 0.50, outputPer1M: 3.00 },
  'google/gemini-3-flash-preview':      { inputPer1M: 0.50, outputPer1M: 3.00 },
  'gemini-2.5-flash':                   { inputPer1M: 0.15, outputPer1M: 0.60 },
  'google/gemini-2.5-flash':            { inputPer1M: 0.15, outputPer1M: 0.60 },
  'claude-haiku-4-5-20251001':          { inputPer1M: 1.00, outputPer1M: 5.00 },
  'anthropic/claude-haiku-4-5-20251001':{ inputPer1M: 1.00, outputPer1M: 5.00 },
  'claude-3-5-haiku-20241022':          { inputPer1M: 1.00, outputPer1M: 5.00 },

  // Mid-high tier (~7-8 credits/msg)
  'gpt-5.1':                   { inputPer1M: 1.25, outputPer1M: 10.00 },
  'openai/gpt-5.1':            { inputPer1M: 1.25, outputPer1M: 10.00 },
  'gpt-5':                     { inputPer1M: 1.25, outputPer1M: 10.00 },
  'gemini-2.5-pro':            { inputPer1M: 1.25, outputPer1M: 10.00 },
  'google/gemini-2.5-pro':     { inputPer1M: 1.25, outputPer1M: 10.00 },
  'gemini-3-pro-preview':      { inputPer1M: 1.25, outputPer1M: 10.00 },
  'gemini-3.1-pro-preview':    { inputPer1M: 1.25, outputPer1M: 10.00 },
  'deepseek-reasoner':         { inputPer1M: 0.70, outputPer1M: 2.50 },
  'deepseek/deepseek-reasoner':{ inputPer1M: 0.70, outputPer1M: 2.50 },

  // Expensive tier (~10-14 credits/msg)
  'gpt-5.2':                            { inputPer1M: 1.75, outputPer1M: 14.00 },
  'openai/gpt-5.2':                     { inputPer1M: 1.75, outputPer1M: 14.00 },
  'gpt-5-chat-latest':                  { inputPer1M: 1.75, outputPer1M: 14.00 },
  'claude-sonnet-4-6':                  { inputPer1M: 3.00, outputPer1M: 15.00 },
  'anthropic/claude-sonnet-4-6':        { inputPer1M: 3.00, outputPer1M: 15.00 },
  'claude-sonnet-4-5-20250929':         { inputPer1M: 3.00, outputPer1M: 15.00 },
  'claude-sonnet-4-20250514':           { inputPer1M: 3.00, outputPer1M: 15.00 },
  'grok-4':                             { inputPer1M: 3.00, outputPer1M: 15.00 },
  'x-ai/grok-4':                        { inputPer1M: 3.00, outputPer1M: 15.00 },
  'o4-mini':                            { inputPer1M: 1.10, outputPer1M: 4.40 },
  'openai/o4-mini':                     { inputPer1M: 1.10, outputPer1M: 4.40 },
  'o3':                                 { inputPer1M: 2.00, outputPer1M: 8.00 },
  'openai/o3':                          { inputPer1M: 2.00, outputPer1M: 8.00 },

  // Premium tier (~21+ credits/msg)
  'claude-opus-4-6':                    { inputPer1M: 5.00, outputPer1M: 25.00 },
  'anthropic/claude-opus-4-6':          { inputPer1M: 5.00, outputPer1M: 25.00 },
  'claude-opus-4-5-20251101':           { inputPer1M: 5.00, outputPer1M: 25.00 },
  'claude-opus-4-1-20250805':           { inputPer1M: 5.00, outputPer1M: 25.00 },
  'claude-opus-4-20250514':             { inputPer1M: 5.00, outputPer1M: 25.00 },

  // Other
  'gpt-4.1':                   { inputPer1M: 2.00, outputPer1M: 8.00 },
  'gpt-4.1-mini':              { inputPer1M: 0.40, outputPer1M: 1.60 },
  'gpt-4.1-nano':              { inputPer1M: 0.10, outputPer1M: 0.40 },
  'gpt-4o':                    { inputPer1M: 2.50, outputPer1M: 10.00 },
  'gpt-4o-mini':               { inputPer1M: 0.15, outputPer1M: 0.60 },
  'chatgpt-4o-latest':         { inputPer1M: 5.00, outputPer1M: 15.00 },
  'gpt-4-turbo':               { inputPer1M: 10.00, outputPer1M: 30.00 },
  'MiniMax-M2.5':              { inputPer1M: 0.50, outputPer1M: 2.00 },
  'MiniMax-M2.5-highspeed':    { inputPer1M: 0.30, outputPer1M: 1.00 },
  'MiniMax-M2.1':              { inputPer1M: 0.30, outputPer1M: 1.00 },
  'MiniMax-M2.1-highspeed':    { inputPer1M: 0.20, outputPer1M: 0.80 },
  'kimi-k2.5':                 { inputPer1M: 1.00, outputPer1M: 4.00 },
};

export function getModelRate(modelId: string): ModelRate {
  return MODEL_RATES[modelId] || DEFAULT_MODEL_RATE;
}

/**
 * Calculate credits to charge for a chat message based on actual token usage.
 * Uses per-model rates with markup to ensure target margin.
 */
export function calculateCredits(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rate = getModelRate(modelId);
  const costUsd =
    (inputTokens * rate.inputPer1M) / 1_000_000 +
    (outputTokens * rate.outputPer1M) / 1_000_000;
  const costRub = costUsd * USD_TO_RUB;
  return Math.max(1, Math.ceil(costRub / CREDIT_VALUE_RUB));
}

/**
 * Estimate credits for a typical message (2000 input + 700 output tokens).
 * Used for display in model picker.
 */
export function estimateCreditsPerMessage(modelId: string): number {
  return calculateCredits(modelId, 2000, 700);
}
```

**Step 2: Update constants.ts — new plan limits and topup packages**

Modify `src/server/modules/billing/constants.ts`. Replace the entire file:

```typescript
// Credit costs by action type (for image/video, kept for backward compatibility)
export const CREDIT_COSTS = {
  image: 10,     // image generation
  text: 1,       // minimum per text message
  video: 30,     // video generation
} as const;

export const TOPUP_PACKAGES = [
  { amountRub: 99,   credits: 400,   label: '400 кредитов'   },
  { amountRub: 399,  credits: 1800,  label: '1 800 кредитов' },
  { amountRub: 999,  credits: 5000,  label: '5 000 кредитов' },
] as const;

export type TopupPackage = (typeof TOPUP_PACKAGES)[number];

export function getTopupPackage(amountRub: number): TopupPackage | undefined {
  return TOPUP_PACKAGES.find((p) => p.amountRub === amountRub);
}
```

**Step 3: Build to verify**

Run: `npx next build --webpack 2>&1 | tail -5`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/server/modules/billing/model-rates.ts src/server/modules/billing/constants.ts
git commit -m "feat(billing): add per-model credit rates config and update plan constants"
```

---

### Task 2: Implement credit deduction after chat

**Files:**
- Modify: `src/app/(backend)/webapi/chat/[provider]/route.ts`
- Modify: `src/server/modules/billing/checkUsageLimit.ts`

**Step 1: Update `recordTokenUsage` to accept model ID**

Modify `src/server/modules/billing/checkUsageLimit.ts`. Replace `recordTokenUsage` function:

```typescript
import { calculateCredits } from './model-rates';

export async function recordTokenUsage(
  db: LobeChatDatabase,
  userId: string,
  tokensUsed: number,
  modelId?: string,
  outputTokens?: number,
): Promise<void> {
  if (tokensUsed <= 0 && (!outputTokens || outputTokens <= 0)) return;
  try {
    let credits: number;
    if (modelId && outputTokens !== undefined) {
      // Per-model pricing: calculate from actual input/output tokens
      credits = calculateCredits(modelId, tokensUsed, outputTokens);
    } else {
      // Legacy fallback: flat rate (for image/video that still use total tokens)
      credits = Math.max(1, Math.ceil(tokensUsed / 2500));
    }
    const billingService = new BillingService(db, userId);
    await billingService.incrementTokensUsed(credits);
    console.log(`[billing] charged ${credits} credits: user=${userId} model=${modelId || 'unknown'} in=${tokensUsed} out=${outputTokens || 0}`);
  } catch (error) {
    console.error('[billing] recordTokenUsage error:', error);
  }
}
```

**Step 2: Add credit deduction to chat route**

Modify `src/app/(backend)/webapi/chat/[provider]/route.ts`. Replace the return statement (line 52-56) with a wrapper that intercepts the response:

```typescript
      const response = await modelRuntime.chat(data, {
        user: userId,
        ...traceOptions,
        signal: req.signal,
      });

      // Charge credits after streaming completes (fire-and-forget)
      // Clone the response to read usage without consuming the stream
      if (response instanceof Response) {
        const clonedResponse = response.clone();
        // Extract usage from SSE stream in background
        (async () => {
          try {
            const { recordTokenUsage } = await import(
              '@/server/modules/billing/checkUsageLimit'
            );
            const reader = clonedResponse.body?.getReader();
            if (!reader) return;

            const decoder = new TextDecoder();
            let usageData: { input?: number; output?: number } = {};

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const chunk = decoder.decode(value, { stream: true });
              // Look for usage data in SSE stream (format: data: {"usage":...})
              const lines = chunk.split('\n');
              for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const jsonStr = line.slice(6).trim();
                if (jsonStr === '[DONE]') continue;
                try {
                  const parsed = JSON.parse(jsonStr);
                  if (parsed.usage) {
                    usageData = {
                      input: parsed.usage.prompt_tokens || parsed.usage.input_tokens || 0,
                      output:
                        parsed.usage.completion_tokens || parsed.usage.output_tokens || 0,
                    };
                  }
                } catch {
                  // Not JSON, skip
                }
              }
            }

            if (usageData.input || usageData.output) {
              await recordTokenUsage(
                serverDB,
                userId,
                usageData.input || 0,
                data.model,
                usageData.output || 0,
              );
            } else {
              // Fallback: estimate from message content
              const estimatedInput = JSON.stringify(data.messages || []).length / 4;
              await recordTokenUsage(serverDB, userId, Math.max(100, estimatedInput), data.model, 200);
            }
          } catch (e) {
            console.error('[billing] charge after chat error:', e);
          }
        })();
      }

      return response;
```

**Step 3: Build to verify**

Run: `npx next build --webpack 2>&1 | tail -5`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/app/\(backend\)/webapi/chat/\[provider\]/route.ts src/server/modules/billing/checkUsageLimit.ts
git commit -m "feat(billing): add credit deduction after chat with per-model rates"
```

---

### Task 3: Unify providers through OpenRouter

**Files:**
- Modify: `packages/business/model-runtime/src/router-runtime-options.ts`

**Step 1: Simplify router to use OpenRouter for everything**

Replace the entire `packages/business/model-runtime/src/router-runtime-options.ts`:

```typescript
interface RouterInstance {
  apiType: string;
  models?: string[];
  options:
    | Record<string, any>
    | Record<string, any>[];
  transformModel?: (model: string) => string;
}

interface LobehubRouterRuntimeOptions {
  id: string;
  routers: (options: any, runtimeContext: { model?: string }) => Promise<RouterInstance[]>;
}

// Map lobehub short model IDs to OpenRouter format (provider/model)
const OPENROUTER_MODEL_MAP: Record<string, string> = {
  // Anthropic
  'claude-sonnet-4-6': 'anthropic/claude-sonnet-4-6',
  'claude-sonnet-4-5-20250929': 'anthropic/claude-sonnet-4-5-20250929',
  'claude-sonnet-4-20250514': 'anthropic/claude-sonnet-4-20250514',
  'claude-3-7-sonnet-20250219': 'anthropic/claude-3.7-sonnet',
  'claude-opus-4-6': 'anthropic/claude-opus-4-6',
  'claude-opus-4-5-20251101': 'anthropic/claude-opus-4-5-20251101',
  'claude-opus-4-1-20250805': 'anthropic/claude-opus-4-1-20250805',
  'claude-opus-4-20250514': 'anthropic/claude-opus-4-20250514',
  'claude-haiku-4-5-20251001': 'anthropic/claude-haiku-4-5-20251001',
  'claude-3-5-haiku-20241022': 'anthropic/claude-3-5-haiku-20241022',
  // OpenAI
  'gpt-5.2': 'openai/gpt-5.2',
  'gpt-5.1': 'openai/gpt-5.1',
  'gpt-5': 'openai/gpt-5',
  'gpt-5-mini': 'openai/gpt-5-mini',
  'gpt-5-nano': 'openai/gpt-5-nano',
  'gpt-5-chat-latest': 'openai/gpt-5-chat-latest',
  'gpt-4.1': 'openai/gpt-4.1',
  'gpt-4.1-mini': 'openai/gpt-4.1-mini',
  'gpt-4.1-nano': 'openai/gpt-4.1-nano',
  'gpt-4o-mini': 'openai/gpt-4o-mini',
  'gpt-4o': 'openai/gpt-4o',
  'chatgpt-4o-latest': 'openai/chatgpt-4o-latest',
  'gpt-4-turbo': 'openai/gpt-4-turbo',
  'o3': 'openai/o3',
  'o4-mini': 'openai/o4-mini',
  // Google
  'gemini-3.1-pro-preview': 'google/gemini-3.1-pro-preview',
  'gemini-3-pro-preview': 'google/gemini-3-pro-preview',
  'gemini-3-flash-preview': 'google/gemini-3-flash-preview',
  'gemini-2.5-pro': 'google/gemini-2.5-pro',
  'gemini-2.5-flash': 'google/gemini-2.5-flash',
  'gemini-3-pro-image-preview': 'google/gemini-3-pro-image-preview',
  'gemini-2.5-flash-image-preview': 'google/gemini-2.5-flash-preview-05-20',
  'gemini-2.0-flash-exp-image-generation': 'google/gemini-2.0-flash-exp:free',
  // DeepSeek
  'deepseek-chat': 'deepseek/deepseek-chat',
  'deepseek-reasoner': 'deepseek/deepseek-reasoner',
  // xAI
  'grok-4': 'x-ai/grok-4',
  // Moonshot
  'kimi-k2.5': 'moonshotai/kimi-k2.5',
  'kimi-k2-0711-preview': 'moonshotai/kimi-k2-0711-preview',
  // MiniMax
  'MiniMax-M2.5': 'minimax/MiniMax-M2.5',
  'MiniMax-M2.5-highspeed': 'minimax/MiniMax-M2.5-highspeed',
  'MiniMax-M2.1': 'minimax/MiniMax-M2.1',
  'MiniMax-M2.1-highspeed': 'minimax/MiniMax-M2.1-highspeed',
};

export const lobehubRouterRuntimeOptions: LobehubRouterRuntimeOptions = {
  id: 'lobehub',

  routers: async (_options, { model: _model }) => {
    const openrouterKey = process.env.OPENROUTER_API_KEY;
    if (!openrouterKey) return [];

    return [
      {
        apiType: 'openai' as const,
        options: {
          apiKey: openrouterKey,
          baseURL: 'https://openrouter.ai/api/v1',
        },
        transformModel: (model: string) => OPENROUTER_MODEL_MAP[model] || model,
      },
    ];
  },
};
```

**Step 2: Build to verify**

Run: `npx next build --webpack 2>&1 | tail -5`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add packages/business/model-runtime/src/router-runtime-options.ts
git commit -m "feat(provider): unify all AI traffic through OpenRouter"
```

---

### Task 4: Update plan limits in database

**Step 1: Update billing_plans in database**

Run SQL against the LobeChat database:

```bash
docker exec -i lobe-postgres psql -U postgres -d lobechat -c "
UPDATE billing_plans SET token_limit = 30 WHERE slug = 'free';
UPDATE billing_plans SET token_limit = 2500 WHERE slug = 'standard';
UPDATE billing_plans SET token_limit = 7500 WHERE slug = 'pro';
SELECT id, name, slug, price_rub, token_limit FROM billing_plans ORDER BY id;
"
```

Expected output: Three rows with updated token_limit values (30, 2500, 7500).

**Step 2: Commit (no code change, DB-only)**

No commit needed — this is a DB data change.

---

### Task 5: Show credit cost in model picker

**Files:**
- Modify: `src/features/ModelSwitchPanel/components/List/ListItemRenderer.tsx`
- Modify: `src/const/recommended-models.ts`

**Step 1: Add credit cost badge to recommended models**

In `src/features/ModelSwitchPanel/components/List/ListItemRenderer.tsx`, find the `case 'recommended-model'` block (around line 238). Add a credit cost display by importing `estimateCreditsPerMessage` and showing it:

Add import at the top of the file:
```typescript
import { estimateCreditsPerMessage } from '@/server/modules/billing/model-rates';
```

Wait — this is a client component but `model-rates.ts` is server-side. We need to make `estimateCreditsPerMessage` available on client. Two options:
- A) Export a static map of model→credits for client use
- B) Add credit cost to the ListItem data

Option B is cleaner. Add `creditCost` to the recommended model's ListItem type and compute it in `useBuildListItems`.

In `src/features/ModelSwitchPanel/types.ts`, update the `recommended-model` type:
```typescript
  | {
      creditCost: number;
      description: string;
      model: EnabledProviderModelItem;
      provider: EnabledProviderItem;
      type: 'recommended-model';
    }
```

In `src/features/ModelSwitchPanel/hooks/useBuildListItems.ts`, when building recommended items, add `creditCost` from a static map:

```typescript
import { RECOMMENDED_MODELS } from '@/const/recommended-models';

// Add to the recommended model item construction:
creditCost: rec.creditCost || 1,
```

Update `src/const/recommended-models.ts` to include `creditCost`:

```typescript
export interface RecommendedModel {
  creditCost: number;
  description: string;
  modelId: string;
  order: number;
}

export const RECOMMENDED_MODELS: RecommendedModel[] = [
  {
    creditCost: 13,
    description: 'Умный и быстрый — для большинства задач',
    modelId: 'claude-sonnet-4-6',
    order: 1,
  },
  {
    creditCost: 10,
    description: 'Флагман для сложных задач',
    modelId: 'gpt-5.2',
    order: 2,
  },
  {
    creditCost: 1,
    description: 'Самый быстрый — простые вопросы',
    modelId: 'gpt-5-mini',
    order: 3,
  },
  {
    creditCost: 8,
    description: 'Глубокий анализ — математика, код',
    modelId: 'deepseek-reasoner',
    order: 4,
  },
];
```

**Step 2: Display credit badge in ListItemRenderer**

In the `case 'recommended-model'` block of `ListItemRenderer.tsx`, add a credit cost badge next to the description:

```typescript
case 'recommended-model': {
  // ... existing code ...
  // After the description Text, add:
  <Text style={{ fontSize: 11 }} type="secondary">
    {item.description} · ~{item.creditCost} кр.
  </Text>
```

**Step 3: Build to verify**

Run: `npx next build --webpack 2>&1 | tail -5`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/features/ModelSwitchPanel/ src/const/recommended-models.ts
git commit -m "feat(ui): show credit cost per model in model picker"
```

---

### Task 6: Deploy and verify

**Step 1: Build Docker image**

```bash
cd /opt/lobechat && docker build -t lobechat-custom:latest -f /home/deploy/projects/ai-aggregator-lobechat/Dockerfile /home/deploy/projects/ai-aggregator-lobechat
```

**Step 2: Update billing_plans in DB**

```bash
docker exec -i lobe-postgres psql -U postgres -d lobechat -c "
UPDATE billing_plans SET token_limit = 30 WHERE slug = 'free';
UPDATE billing_plans SET token_limit = 2500 WHERE slug = 'standard';
UPDATE billing_plans SET token_limit = 7500 WHERE slug = 'pro';
"
```

**Step 3: Restart containers**

```bash
cd /opt/lobechat && docker compose up -d
```

**Step 4: Verify credit deduction**

1. Send a message in chat
2. Check logs: `docker logs lobehub --since=5m 2>&1 | grep billing`
3. Expected: `[billing] charged X credits: user=... model=... in=... out=...`
4. Check balance decreased in the credit widget

**Step 5: Verify model picker**

1. Open chat, click model selector
2. Expected: recommended models show credit costs (~13 кр., ~10 кр., etc.)

**Step 6: Commit any final fixes**

```bash
git add -A && git commit -m "fix: deployment adjustments for credit system v2"
```
