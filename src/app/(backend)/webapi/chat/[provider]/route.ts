import { type ChatCompletionErrorPayload, type ModelRuntime } from '@lobechat/model-runtime';
import { AGENT_RUNTIME_ERROR_SET } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import { createTraceOptions, initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { type ChatStreamPayload } from '@/types/openai/chat';
import { createErrorResponse } from '@/utils/errorResponse';
import { getTracePayload } from '@/utils/trace';

// If user don't use fluid compute, will build  failed
// this enforce user to enable fluid compute
export const maxDuration = 300;

export const POST = checkAuth(
  async (req: Request, { params, userId, serverDB, createRuntime, jwtPayload }) => {
    const provider = (await params)!.provider!;

    try {
      // ============  1. init chat model   ============ //
      let modelRuntime: ModelRuntime;
      if (createRuntime) {
        // Legacy support for custom runtime creation
        modelRuntime = createRuntime(jwtPayload);
      } else {
        // Read user's provider config from database
        modelRuntime = await initModelRuntimeFromDB(serverDB, userId, provider);
      }

      // ============  2. create chat completion   ============ //

      const data = (await req.json()) as ChatStreamPayload;

      // ============  2a. check usage limit  ============ //
      const { checkUsageLimit } = await import('@/server/modules/billing/checkUsageLimit');
      const limitResult = await checkUsageLimit(serverDB, userId, data.model);
      if (!limitResult.allowed) {
        return createErrorResponse(ChatErrorType.InternalServerError, {
          error: { message: limitResult.message },
          errorMessage: limitResult.message,
          provider,
        });
      }

      // ============  2b. check model tier vs plan  ============ //
      const modelId = data.model;
      if (modelId) {
        const { isModelAllowedForPlanAsync, getRequiredPlanForModelAsync } =
          await import('@/server/modules/billing/model-tiers');
        const { BillingService } = await import('@/server/services/billing');
        const billingService = new BillingService(serverDB, userId);
        const planSlug = await billingService.getUserPlanSlug();
        if (!(await isModelAllowedForPlanAsync(modelId, planSlug))) {
          const requiredPlan = await getRequiredPlanForModelAsync(modelId);
          return new Response(
            JSON.stringify({
              currentPlan: planSlug,
              errorType: 'PlanLimitExceeded',
              message: `Модель ${modelId} недоступна на тарифе «${planSlug}». Обновите подписку до «${requiredPlan}».`,
              requiredPlan,
            }),
            { headers: { 'Content-Type': 'application/json' }, status: 403 },
          );
        }
      }

      const tracePayload = getTracePayload(req);

      let traceOptions = {};
      // If user enable trace
      if (tracePayload?.enabled) {
        traceOptions = createTraceOptions(data, { provider, trace: tracePayload });
      }

      const response = await modelRuntime.chat(data, {
        user: userId,
        ...traceOptions,
        signal: req.signal,
      });

      // Charge credits after streaming completes (fire-and-forget)
      if (response instanceof Response) {
        const clonedResponse = response.clone();
        (async () => {
          try {
            const { recordTokenUsage } = await import('@/server/modules/billing/checkUsageLimit');
            const reader = clonedResponse.body?.getReader();
            if (!reader) return;

            const decoder = new TextDecoder();
            let usageData: {
              input?: number;
              output?: number;
              cacheWrite5m?: number;
              cacheWrite1h?: number;
              cacheRead?: number;
            } = {};
            let observedOutputChars = 0;

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const chunk = decoder.decode(value, { stream: true });
              const lines = chunk.split('\n');
              for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const jsonStr = line.slice(6).trim();
                if (jsonStr === '[DONE]') continue;
                try {
                  const parsed = JSON.parse(jsonStr);
                  if (parsed.usage) {
                    const u = parsed.usage;
                    usageData = {
                      input: u.prompt_tokens || u.input_tokens || 0,
                      output: u.completion_tokens || u.output_tokens || 0,
                      // Anthropic: cache_creation_input_tokens (5m default),
                      // or detailed cache_creation.ephemeral_5m_input_tokens /
                      // ephemeral_1h_input_tokens for explicit TTL.
                      cacheWrite5m:
                        u.cache_creation?.ephemeral_5m_input_tokens ??
                        u.cache_creation_input_tokens ??
                        0,
                      cacheWrite1h: u.cache_creation?.ephemeral_1h_input_tokens ?? 0,
                      // Anthropic: cache_read_input_tokens. OpenAI:
                      // prompt_tokens_details.cached_tokens. Gemini:
                      // usage_metadata.cached_content_token_count.
                      cacheRead:
                        u.cache_read_input_tokens ??
                        u.prompt_tokens_details?.cached_tokens ??
                        u.cached_content_token_count ??
                        0,
                    };
                  }
                  // Observe streamed content to estimate output when upstream
                  // doesn't report usage (common for non-OpenAI compatible providers).
                  const delta = parsed?.choices?.[0]?.delta?.content;
                  if (typeof delta === 'string') observedOutputChars += delta.length;
                  const text = parsed?.choices?.[0]?.message?.content;
                  if (typeof text === 'string') observedOutputChars += text.length;
                  // Anthropic-style streaming deltas
                  const anthropicDelta = parsed?.delta?.text;
                  if (typeof anthropicDelta === 'string') {
                    observedOutputChars += anthropicDelta.length;
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
                {
                  provider,
                  kind: 'chat',
                  cacheWrite5mTokens: usageData.cacheWrite5m || 0,
                  cacheWrite1hTokens: usageData.cacheWrite1h || 0,
                  cacheReadTokens: usageData.cacheRead || 0,
                },
              );
            } else {
              // Fallback: estimate from message content length + observed stream.
              // CRITICAL: never use outputTokens=0, otherwise calculateCredits
              // undercounts by ~600x (output is where the cost lives).
              const estimatedInput = Math.max(
                100,
                Math.round(JSON.stringify(data.messages || []).length / 4),
              );
              // Use observed output chars if streamed; otherwise estimate a
              // conservative floor (50% of input, min 500 tokens) so we never
              // charge a fraction of the real cost.
              const estimatedOutput =
                observedOutputChars > 0
                  ? Math.ceil(observedOutputChars / 4)
                  : Math.max(500, Math.round(estimatedInput * 0.5));
              await recordTokenUsage(
                serverDB,
                userId,
                estimatedInput,
                data.model,
                estimatedOutput,
                { provider, kind: 'chat' },
              );
            }
          } catch (e) {
            console.error('[billing] charge after chat error:', e);
          }
        })();
      }

      return response;
    } catch (e) {
      const {
        errorType = ChatErrorType.InternalServerError,
        error: errorContent,
        ...res
      } = e as ChatCompletionErrorPayload;

      const error = errorContent || e;

      const logMethod = AGENT_RUNTIME_ERROR_SET.has(errorType as string) ? 'warn' : 'error';
      // track the error at server side
      console[logMethod](`Route: [${provider}] ${errorType}:`, error);

      return createErrorResponse(errorType, { error, ...res, provider });
    }
  },
);
