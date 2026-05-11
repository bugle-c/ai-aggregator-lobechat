interface RouterInstance {
  apiType: string;
  models?: string[];
  options: Record<string, any> | Record<string, any>[];
  transformModel?: (model: string) => string;
  /** Optional payload rewrite — see createRuntime.ts RouterInstance type. */
  transformPayload?: (payload: any) => any;
}

interface LobehubRouterRuntimeOptions {
  id: string;
  routers: (options: any, runtimeContext: { model?: string }) => Promise<RouterInstance[]>;
}

// Map lobehub short model IDs to OpenRouter slugs (provider/model).
//
// The ENTIRE Anthropic block previously used dash-style version numbers
// (`anthropic/claude-sonnet-4-6`, `claude-haiku-4-5-20251001`, …). OpenRouter
// rejects those with `is not a valid model ID` 400s. Their canonical slugs
// use dot-style versions (`anthropic/claude-sonnet-4.6`). The MiniMax slugs
// were also mis-cased — OpenRouter normalises to lowercase `minimax/minimax-m2.5`.
// DeepSeek `deepseek-chat`/`deepseek-reasoner` are no longer published on
// OpenRouter; the latest equivalents are `deepseek/deepseek-v3.2` (chat) and
// `deepseek/deepseek-v3.2-speciale` (reasoning).
//
// Verified against `GET https://openrouter.ai/api/v1/models` on 2026-04-30.
const OPENROUTER_MODEL_MAP: Record<string, string> = {
  // Anthropic — dot-style versions; legacy date-suffixed catalogue ids fold
  // into the closest active OpenRouter release.
  'claude-sonnet-4-6': 'anthropic/claude-sonnet-4.6',
  'claude-sonnet-4-5-20250929': 'anthropic/claude-sonnet-4.5',
  'claude-sonnet-4-20250514': 'anthropic/claude-sonnet-4',
  'claude-3-7-sonnet-20250219': 'anthropic/claude-3.7-sonnet',
  'claude-opus-4-6': 'anthropic/claude-opus-4.6',
  'claude-opus-4-5-20251101': 'anthropic/claude-opus-4.5',
  'claude-opus-4-1-20250805': 'anthropic/claude-opus-4.1',
  'claude-opus-4-20250514': 'anthropic/claude-opus-4',
  'claude-haiku-4-5-20251001': 'anthropic/claude-haiku-4.5',
  'claude-3-5-haiku-20241022': 'anthropic/claude-3.5-haiku',
  // OpenAI — already correct
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
  // OpenRouter only ships `gemini-3.1-pro-preview` — alias the older catalog
  // id to it so existing chats don't 400 on selector change.
  'gemini-3-pro-preview': 'google/gemini-3.1-pro-preview',
  'gemini-3-flash-preview': 'google/gemini-3-flash-preview',
  'gemini-3-pro-image-preview': 'google/gemini-3-pro-image-preview',
  'gemini-2.5-pro': 'google/gemini-2.5-pro',
  'gemini-2.5-flash': 'google/gemini-2.5-flash',
  'gemini-2.5-flash-image-preview': 'google/gemini-2.5-flash-image-preview',
  'gemini-2.0-flash-exp-image-generation': 'google/gemini-2.0-flash-exp:free',
  // DeepSeek — `deepseek-chat`/`deepseek-reasoner` are retired on OpenRouter.
  'deepseek-chat': 'deepseek/deepseek-v3.2',
  'deepseek-reasoner': 'deepseek/deepseek-v3.2-speciale',
  // xAI
  'grok-4': 'x-ai/grok-4',
  // Moonshot
  'kimi-k2.5': 'moonshotai/kimi-k2.5',
  'kimi-k2-0711-preview': 'moonshotai/kimi-k2-0711-preview',
  // MiniMax — lowercase, dot-style
  'MiniMax-M2.5': 'minimax/minimax-m2.5',
  'MiniMax-M2.5-highspeed': 'minimax/minimax-m2.5-highspeed',
  'MiniMax-M2.1': 'minimax/minimax-m2.1',
  'MiniMax-M2.1-highspeed': 'minimax/minimax-m2.1-highspeed',
};

/**
 * Image-model routing for the lobehub provider.
 *
 * The catalog at `model-bank/aiModels/lobehub/image.ts` exposes ~14 curated
 * image models PLUS every Wavespeed image model with `enabled: true` (flux,
 * recraft, ideogram, sora, kling, …). Each model needs to land at a different
 * upstream — OpenRouter does not implement `images.generate` and silently
 * returned `{}` (no `data` array), causing the user-visible
 * `Invalid image response: missing or empty data array` error.
 *
 * The match is by id-prefix/exact id. Order matters: `fal-ai/` is checked
 * before the generic slashed-id rule because Fal endpoints overlap with
 * Wavespeed naming.
 */
const isFalModel = (model: string) => model.startsWith('fal-ai/');
const isOpenAIDirectImage = (model: string) =>
  model.startsWith('gpt-image-') || model.startsWith('dall-e-');
const isGoogleDirectImage = (model: string) =>
  model.startsWith('imagen-') || model.endsWith(':image');

// Local models served by Ollama on the same host (see /opt/ollama). Routed
// here as a separate branch so we don't hit OpenRouter for them. Ollama is
// OpenAI-compatible — same `apiType: 'openai'`, only the baseURL changes.
// Reachable as `http://ollama:11434/v1` from the lobe container because
// `network-service` is attached to the `ollama_default` bridge (see
// /opt/lobechat/docker-compose.yml).
const LOCAL_OLLAMA_MODELS = new Set([
  'gemma4:e4b',
  'hf.co/TrevorJS/gemma-4-26B-A4B-it-uncensored-GGUF:Q4_K_M',
  'qwen3-coder:30b-32k',
]);
const isLocalOllamaModel = (model: string) => LOCAL_OLLAMA_MODELS.has(model);

// Wavespeed IDs always have a `/` and are not handled by the rules above.
// Local Ollama IDs also contain slashes (`hf.co/...`) so we must filter them
// out before falling through to wavespeed.
const isWavespeedModel = (model: string) =>
  model.includes('/') && !isFalModel(model) && !isLocalOllamaModel(model);

export const lobehubRouterRuntimeOptions: LobehubRouterRuntimeOptions = {
  id: 'lobehub',

  routers: async (_options, { model }) => {
    // Local Ollama models — route to our own server before any other rule.
    // They look like `<slug>:<tag>` or `hf.co/<repo>:<quant>`, so they can
    // otherwise collide with wavespeed's slashed-id heuristic.
    if (model && isLocalOllamaModel(model)) {
      return [
        {
          apiType: 'openai' as const,
          // Ollama ignores the auth header, but openai SDK requires a
          // non-empty apiKey. Sending a literal `ollama` is the convention.
          options: {
            apiKey: 'ollama',
            baseURL: 'http://ollama:11434/v1',
          },
          // Two hardenings before forwarding to Ollama:
          // 1. `reasoning_effort: 'none'` — the only knob the OpenAI-compat
          //    surface of Ollama honours to suppress Gemma 4 thinking-mode.
          //    `think: false` is silently ignored, system prompts don't help.
          //    Without this, raw `<|channel>thought ... <channel|>` tokens
          //    leak into the visible reply. Tested directly against
          //    /v1/chat/completions on 2026-05-11.
          // 2. Pinned WebGPT system prompt — Gemma 4's training corpus
          //    includes LobeChat content, so when free-running it sometimes
          //    signs off as "Lobe" or "Совет от Lobe:". This prompt is
          //    prepended to (not replacing) whatever the user's agent
          //    system role is, so per-session customisation still works.
          transformPayload: (p: any) => {
            const PINNED_SYSTEM = [
              'Ты — WebGPT, AI-ассистент сервиса gptweb.ru.',
              'Никогда не называй себя Lobe, LobeChat или LobeHub — это устаревшие названия движка, на котором ты НЕ работаешь.',
              'Никогда не подписывайся «Совет от Lobe» или подобным.',
              'Отвечай напрямую и кратко. Не выводи свои размышления, не используй теги <|channel|>, <|thought|>, <|message|>, <|return|>, не показывай служебные токены.',
            ].join(' ');

            const messages = Array.isArray(p.messages) ? [...p.messages] : [];
            if (messages.length > 0 && messages[0]?.role === 'system') {
              const existing = typeof messages[0].content === 'string' ? messages[0].content : '';
              messages[0] = {
                ...messages[0],
                content: existing ? `${PINNED_SYSTEM}\n\n${existing}` : PINNED_SYSTEM,
              };
            } else {
              messages.unshift({ content: PINNED_SYSTEM, role: 'system' });
            }
            return { ...p, messages, reasoning_effort: 'none' };
          },
        },
      ];
    }

    // Image models — route to the actual upstream that hosts them.
    if (model) {
      if (isOpenAIDirectImage(model)) {
        const key = process.env.OPENAI_API_KEY;
        if (!key) return [];
        return [{ apiType: 'openai' as const, options: { apiKey: key } }];
      }

      if (isGoogleDirectImage(model)) {
        const key = process.env.GOOGLE_API_KEY;
        if (!key) return [];
        // Strip the `:image` suffix the catalog uses to disambiguate the
        // chat-vs-image variant of Gemini multimodal models. The Google
        // SDK expects the bare model id.
        return [
          {
            apiType: 'google' as const,
            options: { apiKey: key },
            transformModel: (m: string) => m.replace(/:image$/, ''),
          },
        ];
      }

      if (isFalModel(model)) {
        const key = process.env.FAL_API_KEY;
        if (!key) return [];
        return [{ apiType: 'fal' as const, options: { apiKey: key } }];
      }

      if (isWavespeedModel(model)) {
        const key = process.env.WAVESPEED_API_KEY;
        if (!key) return [];
        return [{ apiType: 'wavespeed' as const, options: { apiKey: key } }];
      }
    }

    // Default — chat models go through OpenRouter with the legacy mapping.
    const openrouterKey = process.env.OPENROUTER_API_KEY;
    if (!openrouterKey) return [];

    return [
      {
        apiType: 'openai' as const,
        options: {
          apiKey: openrouterKey,
          baseURL: 'https://openrouter.ai/api/v1',
        },
        transformModel: (m: string) => OPENROUTER_MODEL_MAP[m] || m,
      },
    ];
  },
};
