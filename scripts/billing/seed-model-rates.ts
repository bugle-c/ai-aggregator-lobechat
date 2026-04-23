import { MODEL_RATES } from '../../src/server/modules/billing/model-rates';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://supabase.pashavin.ru';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY missing');
  process.exit(1);
}

// Provider lookup is duplicated from model-rates.ts (kept unexported there).
// Keep in sync if openRouterPrefixes changes.
const PROVIDER_OF: Record<string, string> = {
  'deepseek-chat': 'deepseek', 'deepseek-reasoner': 'deepseek',
  'gpt-5-mini': 'openai', 'gpt-5-nano': 'openai', 'gpt-5.1': 'openai',
  'gpt-5.2': 'openai', 'gpt-5-chat-latest': 'openai',
  'gpt-4.1-mini': 'openai', 'gpt-4.1': 'openai', 'gpt-4o': 'openai',
  'gpt-4o-mini': 'openai', 'chatgpt-4o-latest': 'openai', 'gpt-4-turbo': 'openai',
  'o4-mini': 'openai', 'o3': 'openai',
  'gemini-2.5-flash': 'google', 'gemini-2.5-pro': 'google',
  'gemini-3-flash-preview': 'google', 'gemini-3-pro-preview': 'google',
  'gemini-3.1-pro-preview': 'google',
  'claude-haiku-4-5-20251001': 'anthropic', 'claude-sonnet-4-6': 'anthropic',
  'claude-sonnet-4-5-20250929': 'anthropic', 'claude-opus-4-6': 'anthropic',
  'claude-opus-4-5-20251101': 'anthropic',
  'grok-4': 'x-ai',
  'MiniMax-M2.5': 'minimax', 'MiniMax-M2.5-highspeed': 'minimax', 'MiniMax-M2.1': 'minimax',
};

const rows = [
  // __default__ MUST come first so cache fallback is consistent with raw-insert order
  {
    model_id: '__default__',
    provider: 'unknown',
    pricing_unit: 'tokens',
    input_per_1m: 5.0,
    output_per_1m: 25.0,
    markup: 3.0,
    notes: 'Fallback for unknown chat models. Never delete.',
  },
  ...Object.entries(MODEL_RATES)
    .filter(([id]) => !id.includes('/')) // skip openrouter-prefixed duplicates
    .map(([id, rate]) => ({
      model_id: id,
      provider: PROVIDER_OF[id] || 'unknown',
      pricing_unit: 'tokens' as const,
      input_per_1m: rate.inputPer1M,
      output_per_1m: rate.outputPer1M,
      markup: 3.0,
      notes: null as string | null,
    })),
];

async function main() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/model_rates?on_conflict=model_id`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY!,
      Authorization: `Bearer ${SUPABASE_KEY!}`,
      'Accept-Profile': 'ai_aggregator',
      'Content-Profile': 'ai_aggregator',
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
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
