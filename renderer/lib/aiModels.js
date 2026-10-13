// Providers (AI types), shared by the API Keys editor and the resume
// generator's key dropdown.
export const PROVIDERS = [
  { id: "gemini", label: "Google Gemini" },
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic (Claude)" },
];

// Human-readable provider name, e.g. "Anthropic (Claude)".
export const providerLabel = (id) =>
  (PROVIDERS.find((p) => p.id === id) || {}).label || "Google Gemini";

// Selectable AI models per provider, shared by the API Keys editor and the
// resume generator's key dropdown. The first model is the default for new keys.
export const MODEL_OPTIONS = {
  gemini: [
    { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite — fast & low cost" },
    { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash — balanced" },
    { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash — most intelligent Flash" },
    { id: "gemini-pro-latest", label: "Gemini Pro (latest) — most capable" },
    { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash" },
    { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
    { id: "gemini-flash-latest", label: "Gemini Flash (latest)" },
    { id: "gemini-flash-lite-latest", label: "Gemini Flash-Lite (latest)" },
  ],
  openai: [
    { id: "gpt-5", label: "GPT-5 — most capable" },
    { id: "gpt-5-mini", label: "GPT-5 mini — balanced" },
    { id: "gpt-5-nano", label: "GPT-5 nano — fast & low cost" },
    { id: "gpt-5-chat-latest", label: "GPT-5 Chat (latest)" },
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
    { id: "gpt-4.1-nano", label: "GPT-4.1 nano" },
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4o-mini", label: "GPT-4o mini" },
    { id: "o4-mini", label: "o4-mini — reasoning, fast" },
    { id: "o3", label: "o3 — reasoning" },
  ],
  anthropic: [
    { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
    { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  ],
};

// The provider's default model — the exact model ai.js uses when a key has no
// model set (the first option matches the fallback in electron/ai.js).
export const defaultModel = (provider) => (MODEL_OPTIONS[provider] || [])[0]?.id || "";

// Full label of the model that will ACTUALLY be used (resolves an empty model
// to the provider's default), e.g. "Gemini 3.5 Flash-Lite — fast & low cost".
export const modelLabel = (provider, id) => {
  const real = id || defaultModel(provider);
  return ((MODEL_OPTIONS[provider] || []).find((m) => m.id === real) || {}).label || real || "—";
};

// Short model name (no "— description" suffix), e.g. "Gemini 3.6 Flash".
export const modelShort = (provider, id) => modelLabel(provider, id).split(" — ")[0];

// Even shorter — the brand word dropped — for compact key lists, e.g.
// "Gemini 3.6 Flash" -> "3.6 Flash", "Claude 3.5 Sonnet" -> "3.5 Sonnet".
export const modelTiny = (provider, id) =>
  modelShort(provider, id).replace(/^(Gemini|Claude)\s+/i, "");
