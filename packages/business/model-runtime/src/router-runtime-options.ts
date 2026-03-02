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
  'gemini-3-pro-image-preview': 'google/gemini-3-pro-image-preview',
  'gemini-2.5-pro': 'google/gemini-2.5-pro',
  'gemini-2.5-flash': 'google/gemini-2.5-flash',
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
