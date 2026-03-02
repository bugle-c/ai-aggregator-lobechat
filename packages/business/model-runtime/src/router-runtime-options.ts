interface RouterInstance {
  apiType: string;
  models?: string[];
  options:
    | {
        accessKeyId?: string;
        accessKeySecret?: string;
        apiKey?: string;
        apiVersion?: string;
        baseURL?: string;
        baseURLOrAccountID?: string;
        dangerouslyAllowBrowser?: boolean;
        region?: string;
        sessionToken?: string;
      }
    | {
        accessKeyId?: string;
        accessKeySecret?: string;
        apiKey?: string;
        apiVersion?: string;
        baseURL?: string;
        baseURLOrAccountID?: string;
        dangerouslyAllowBrowser?: boolean;
        region?: string;
        sessionToken?: string;
      }[];
  transformModel?: (model: string) => string;
}

interface LobehubRouterRuntimeOptions {
  id: string;
  routers: (options: any, runtimeContext: { model?: string }) => Promise<RouterInstance[]>;
}

// Models that go through OpenRouter need provider prefix mapping
const OPENROUTER_MODEL_MAP: Record<string, string> = {
  'deepseek-chat': 'deepseek/deepseek-chat',
  'deepseek-reasoner': 'deepseek/deepseek-reasoner',
  'gemini-2.0-flash-exp-image-generation': 'google/gemini-2.0-flash-exp:free',
  'gemini-2.5-flash': 'google/gemini-2.5-flash',
  'gemini-2.5-flash-image-preview': 'google/gemini-2.5-flash-preview-05-20',
  'gemini-2.5-pro': 'google/gemini-2.5-pro',
  'gemini-3-flash-preview': 'google/gemini-3-flash-preview',
  'gemini-3-pro-image-preview': 'google/gemini-3-pro-image-preview',
  'gemini-3-pro-preview': 'google/gemini-3-pro-preview',
  'gemini-3.1-pro-preview': 'google/gemini-3.1-pro-preview',
  'grok-4': 'x-ai/grok-4',
  'kimi-k2-0711-preview': 'moonshotai/kimi-k2-0711-preview',
  'kimi-k2.5': 'moonshotai/kimi-k2.5',
  'MiniMax-M2.1': 'minimax/MiniMax-M2.1',
  'MiniMax-M2.1-highspeed': 'minimax/MiniMax-M2.1-highspeed',
  'MiniMax-M2.5': 'minimax/MiniMax-M2.5',
  'MiniMax-M2.5-highspeed': 'minimax/MiniMax-M2.5-highspeed',
};

export const lobehubRouterRuntimeOptions: LobehubRouterRuntimeOptions = {
  id: 'lobehub',

  routers: async (_options, { model: _model }) => {
    const routers: RouterInstance[] = [];

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    const openrouterKey = process.env.OPENROUTER_API_KEY;

    // Anthropic router for Claude models (direct API)
    if (anthropicKey) {
      routers.push({
        apiType: 'anthropic',
        models: [
          'claude-sonnet-4-6',
          'claude-sonnet-4-5-20250929',
          'claude-sonnet-4-20250514',
          'claude-3-7-sonnet-20250219',
          'claude-opus-4-6',
          'claude-opus-4-5-20251101',
          'claude-opus-4-1-20250805',
          'claude-opus-4-20250514',
          'claude-haiku-4-5-20251001',
          'claude-3-5-haiku-20241022',
        ],
        options: { apiKey: anthropicKey },
      });
    }

    // OpenAI router for GPT/o-series models (direct API)
    if (openaiKey) {
      routers.push({
        apiType: 'openai',
        models: [
          'gpt-5.2',
          'gpt-5.1',
          'gpt-5',
          'gpt-5-mini',
          'gpt-5-nano',
          'gpt-5-chat-latest',
          'gpt-4.1',
          'gpt-4.1-mini',
          'gpt-4.1-nano',
          'gpt-4o-mini',
          'gpt-4o',
          'chatgpt-4o-latest',
          'gpt-4-turbo',
          'o3',
          'o4-mini',
        ],
        options: { apiKey: openaiKey },
      });
    }

    // OpenRouter fallback for all other models (Gemini, DeepSeek, Grok, etc.)
    if (openrouterKey) {
      routers.push({
        apiType: 'openai',
        models: Object.keys(OPENROUTER_MODEL_MAP),
        options: {
          apiKey: openrouterKey,
          baseURL: 'https://openrouter.ai/api/v1',
        },
        transformModel: (model: string) => OPENROUTER_MODEL_MAP[model] || model,
      });
    }

    return routers;
  },
};
