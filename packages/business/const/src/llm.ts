export const DEFAULT_EMBEDDING_PROVIDER = 'openai';

// Route system-agent calls (Translate, topic naming, history compress,
// query rewrite, etc.) through `lobehub` so they go through our
// OpenRouter-backed router and credits flow through recordTokenUsage like
// regular chat. Without this, every system-agent action defaulted to
// `provider='anthropic'` / `'openai'` direct — but ENABLED_ANTHROPIC=0 /
// ENABLED_OPENAI=0 in production, so Translate/topic-naming silently 404'd
// (`Route: [openai] InvalidProviderAPIKey` in logs).
export const DEFAULT_PROVIDER = 'lobehub';
export const DEFAULT_MINI_PROVIDER = 'lobehub';
