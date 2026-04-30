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
