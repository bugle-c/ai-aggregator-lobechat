const SUPABASE_URL = process.env.SUPABASE_URL || 'https://supabase.pashavin.ru';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY missing');
  process.exit(1);
}

// Inlined seed catalogue. Source of truth at runtime is ai_aggregator.model_rates;
// this script only seeds initial rows. Keep provider map below in sync when adding models.
const MODEL_RATES_SEED: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  // === Cheap ===
  'deepseek-chat': { inputPer1M: 0.32, outputPer1M: 0.89 },
  'gpt-5-mini': { inputPer1M: 0.25, outputPer1M: 2 },
  'gpt-5-nano': { inputPer1M: 0.1, outputPer1M: 0.4 },
  'gemini-2.5-flash': { inputPer1M: 0.15, outputPer1M: 0.6 },

  // === Mid ===
  'gemini-3-flash-preview': { inputPer1M: 0.5, outputPer1M: 3 },
  'claude-haiku-4-5-20251001': { inputPer1M: 1, outputPer1M: 5 },
  'gpt-4.1-mini': { inputPer1M: 0.4, outputPer1M: 1.6 },

  // === Mid-high ===
  'gpt-5.1': { inputPer1M: 1.25, outputPer1M: 10 },
  'gemini-2.5-pro': { inputPer1M: 1.25, outputPer1M: 10 },
  'gemini-3-pro-preview': { inputPer1M: 1.25, outputPer1M: 10 },
  'gemini-3.1-pro-preview': { inputPer1M: 1.25, outputPer1M: 10 },
  'deepseek-reasoner': { inputPer1M: 0.7, outputPer1M: 2.5 },
  'gpt-4.1': { inputPer1M: 2, outputPer1M: 8 },
  'o4-mini': { inputPer1M: 1.1, outputPer1M: 4.4 },

  // === Expensive ===
  'gpt-5.2': { inputPer1M: 1.75, outputPer1M: 14 },
  'gpt-5-chat-latest': { inputPer1M: 1.75, outputPer1M: 14 },
  'claude-sonnet-4-6': { inputPer1M: 3, outputPer1M: 15 },
  'claude-sonnet-4-5-20250929': { inputPer1M: 3, outputPer1M: 15 },
  'grok-4': { inputPer1M: 3, outputPer1M: 15 },
  'o3': { inputPer1M: 2, outputPer1M: 8 },

  // === Premium ===
  'claude-opus-4-6': { inputPer1M: 5, outputPer1M: 25 },
  'claude-opus-4-5-20251101': { inputPer1M: 5, outputPer1M: 25 },

  // === Legacy ===
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
  'chatgpt-4o-latest': { inputPer1M: 5, outputPer1M: 15 },
  'gpt-4-turbo': { inputPer1M: 10, outputPer1M: 30 },

  // === Other ===
  'MiniMax-M2.5': { inputPer1M: 0.5, outputPer1M: 2 },
  'MiniMax-M2.5-highspeed': { inputPer1M: 0.3, outputPer1M: 1 },
  'MiniMax-M2.1': { inputPer1M: 0.3, outputPer1M: 1 },
  'MiniMax-M2.1-highspeed': { inputPer1M: 0.2, outputPer1M: 0.8 },
  'kimi-k2.5': { inputPer1M: 1, outputPer1M: 4 },
};

// Provider lookup for the seed set. Keep in sync with MODEL_RATES_SEED above.
const PROVIDER_OF: Record<string, string> = {
  'deepseek-chat': 'deepseek',
  'deepseek-reasoner': 'deepseek',
  'gpt-5-mini': 'openai',
  'gpt-5-nano': 'openai',
  'gpt-5.1': 'openai',
  'gpt-5.2': 'openai',
  'gpt-5-chat-latest': 'openai',
  'gpt-4.1-mini': 'openai',
  'gpt-4.1': 'openai',
  'gpt-4o': 'openai',
  'gpt-4o-mini': 'openai',
  'chatgpt-4o-latest': 'openai',
  'gpt-4-turbo': 'openai',
  'o4-mini': 'openai',
  'o3': 'openai',
  'gemini-2.5-flash': 'google',
  'gemini-2.5-pro': 'google',
  'gemini-3-flash-preview': 'google',
  'gemini-3-pro-preview': 'google',
  'gemini-3.1-pro-preview': 'google',
  'claude-haiku-4-5-20251001': 'anthropic',
  'claude-sonnet-4-6': 'anthropic',
  'claude-sonnet-4-5-20250929': 'anthropic',
  'claude-opus-4-6': 'anthropic',
  'claude-opus-4-5-20251101': 'anthropic',
  'grok-4': 'x-ai',
  'MiniMax-M2.5': 'minimax',
  'MiniMax-M2.5-highspeed': 'minimax',
  'MiniMax-M2.1': 'minimax',
  'MiniMax-M2.1-highspeed': 'minimax',
  'kimi-k2.5': 'moonshotai',
};

const rows = [
  // __default__ MUST come first so cache fallback is consistent with raw-insert order
  {
    model_id: '__default__',
    provider: 'unknown',
    pricing_unit: 'tokens',
    input_per_1m: 5,
    output_per_1m: 25,
    markup: 3,
    notes: 'Fallback for unknown chat models. Never delete.',
  },
  ...Object.entries(MODEL_RATES_SEED).map(([id, rate]) => ({
    model_id: id,
    provider: PROVIDER_OF[id] || 'unknown',
    pricing_unit: 'tokens' as const,
    input_per_1m: rate.inputPer1M,
    output_per_1m: rate.outputPer1M,
    markup: 3,
    notes: null as string | null,
  })),
];

async function main() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/model_rates?on_conflict=model_id`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY!,
      'Authorization': `Bearer ${SUPABASE_KEY!}`,
      'Accept-Profile': 'ai_aggregator',
      'Content-Profile': 'ai_aggregator',
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    console.error('seed failed:', res.status, await res.text());
    process.exit(1);
  }
  const data = (await res.json()) as unknown[];
  console.log(`seeded ${data.length} model_rates rows`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
