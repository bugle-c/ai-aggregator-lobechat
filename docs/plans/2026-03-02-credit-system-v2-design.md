# Credit System v2 — Per-Model Pricing + Token-Based Billing

## Goal

Replace the current flat-rate credit system (1 credit = 1 message regardless of model) with per-model pricing that charges based on actual token usage. Ensure 75% cost-to-revenue ratio (25% margin). Fix the critical bug where credits are never deducted after chat messages.

## Architecture

- **Single provider**: Route all AI traffic through OpenRouter (one API key)
- **Per-model rates**: Each model has input/output token rates stored in a config file
- **Real-time billing**: After each chat stream completes, calculate cost from actual token usage and deduct credits
- **Image/Video**: WaveSpeed (already integrated) with fixed credit costs per generation

## Key Decisions

1. **Config file over DB table** for model rates — simpler, no migration, easy to update
2. **OpenRouter as sole provider** — eliminates managing 3 API keys, 5.5% platform fee is acceptable
3. **Credits ≈ rubles** — 1 credit ≈ 0.20₽ selling price, making plans intuitive
4. **Minimum charge**: 1 credit per message regardless of actual token count

## Financial Model

### Plans

| Plan | Price | Credits/month | API budget (75%) | Msgs at avg 4 cr |
|------|-------|---------------|-----------------|------------------|
| Start | 0₽ | 30 | 6₽ | ~7 |
| Standard | 490₽ | 2,500 | 375₽ | ~625 |
| Pro | 1,490₽ | 7,500 | 1,125₽ | ~1,875 |

### Top-up Packages

| Price | Credits | Per credit |
|-------|---------|-----------|
| 99₽ | 400 | 0.25₽ |
| 399₽ | 1,800 | 0.22₽ |
| 999₽ | 5,000 | 0.20₽ |

### Model Credit Costs (per typical message: 2000 input + 700 output tokens)

| Model | API cost/msg | Credits/msg |
|-------|-------------|-------------|
| DeepSeek Chat | 0.13₽ | 1 |
| GPT-5-mini | 0.19₽ | 1 |
| Gemini 3 Flash | 0.31₽ | 2 |
| Claude Haiku 4.5 | 0.55₽ | 4 |
| GPT-5.1 | 0.95₽ | 7 |
| Gemini 2.5 Pro | 0.95₽ | 7 |
| DeepSeek Reasoner | 1.07₽ | 8 |
| GPT-5.2 | 1.33₽ | 10 |
| Claude Sonnet 4.6 | 1.65₽ | 13 |
| Grok-4 | 1.65₽ | 13 |
| o4-mini | 1.85₽ | 14 |
| Claude Opus 4.6 | 2.75₽ | 21 |
| o3 | 3.36₽ | 26 |

## Components

### 1. Model Rates Config (`src/server/modules/billing/model-rates.ts`)
- Map of model ID → { inputPer1M, outputPer1M } in USD
- Default fallback rate (Claude Sonnet pricing as safe middle)
- Function: `calculateCredits(modelId, inputTokens, outputTokens) → number`

### 2. Chat Post-Stream Billing (`chargeAfterChat`)
- Extract `usage` from SSE stream response (input_tokens, output_tokens)
- Call `calculateCredits()` with model and actual tokens
- Call `billingService.incrementTokensUsed(credits)`
- Integrate into `/webapi/chat/[provider]/route.ts`

### 3. OpenRouter Unification
- Remove direct OpenAI and Anthropic API keys from config
- Update `router-runtime-options.ts`: single OpenRouter router with model ID mapping
- All lobehub models → OpenRouter with `provider/model` format

### 4. Updated Plans in DB
- Update `billing_plans`: new credit limits (30, 2500, 7500)
- Update `TOPUP_PACKAGES` constant (99₽/400, 399₽/1800, 999₽/5000)

### 5. UI: Credit Cost in Model Picker
- Show estimated credits per message next to each model name
- Format: "~13 кредитов" in secondary text
