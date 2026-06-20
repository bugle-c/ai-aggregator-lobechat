// Default chat model for all new users / agents. We previously defaulted
// to the local Gemma 4 E4B (zero provider cost), but on our shared,
// CPU-only Hetzner box it answers simple prompts in 5–10 minutes — far
// past what users will wait. gpt-5-mini (cloud, via the `lobehub`
// gateway) is the cheapest fast cloud option and keeps the out-of-box
// experience snappy. Gemma stays available in the picker as the free
// "cheapest, but slower" choice. Provider stays `lobehub`
// (DEFAULT_PROVIDER) — both local and cloud models route under it.
export const DEFAULT_MODEL = 'gpt-5-mini';
export const DEFAULT_MINI_MODEL = 'gpt-5-mini';

export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';

export const DEFAULT_RERANK_MODEL = 'rerank-english-v3.0';
export const DEFAULT_RERANK_PROVIDER = 'cohere';
export const DEFAULT_RERANK_QUERY_MODE = 'full_text';
