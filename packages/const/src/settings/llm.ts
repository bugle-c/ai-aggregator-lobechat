// Default chat model for all new users / agents. Gemma 4 E4B running
// locally on Hetzner CPU — cheapest by far (~2-3x cheaper per token
// than gpt-5-nano, the cheapest cloud option). Users on paid plans can
// switch to premium cloud models in the picker; the default just keeps
// the free-tier experience usable without burning cloud-API spend.
// Provider stays `lobehub` (DEFAULT_PROVIDER) — local models live under
// that umbrella per packages/model-bank/.../lobehub/chat/local.ts.
export const DEFAULT_MODEL = 'gemma4:e4b';
export const DEFAULT_MINI_MODEL = 'gpt-5-mini';

export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';

export const DEFAULT_RERANK_MODEL = 'rerank-english-v3.0';
export const DEFAULT_RERANK_PROVIDER = 'cohere';
export const DEFAULT_RERANK_QUERY_MODE = 'full_text';
