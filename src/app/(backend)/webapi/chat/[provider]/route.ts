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
      const limitResult = await checkUsageLimit(serverDB, userId);
      if (!limitResult.allowed) {
        return createErrorResponse(ChatErrorType.InternalServerError, {
          error: { message: limitResult.message },
          errorMessage: limitResult.message,
          provider,
        });
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
                      output: parsed.usage.completion_tokens || parsed.usage.output_tokens || 0,
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
              // Fallback: estimate from message content length
              const estimatedInput = JSON.stringify(data.messages || []).length / 4;
              await recordTokenUsage(
                serverDB,
                userId,
                Math.max(100, Math.round(estimatedInput)),
                data.model,
                200,
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
