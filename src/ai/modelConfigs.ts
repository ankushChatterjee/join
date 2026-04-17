// ============================================================================
// AI Model Configuration
// ============================================================================

export type ProviderId = "anthropic" | "gemini" | "moonshotai" | "openai" | "zai";

export interface ModelConfig {
  id: string;
  name: string;
  providerId: ProviderId;
  maxOutputTokens: number;
  envVar: string;
}

export const MODEL_CONFIGS: ModelConfig[] = [
  {
    id: "gpt-5.4-mini",
    name: "GPT-5.4 Mini",
    providerId: "openai",
    maxOutputTokens: 16384,
    envVar: "OPENAI_API_KEY",
  },
  {
    id: "gpt-5.4",
    name: "GPT-5.4",
    providerId: "openai",
    maxOutputTokens: 16384,
    envVar: "OPENAI_API_KEY",
  },
  {
    id: "gpt-5.3-codex",
    name: "GPT-5.3 Codex",
    providerId: "openai",
    maxOutputTokens: 16384,
    envVar: "OPENAI_API_KEY",
  },
  {
    id: "claude-sonnet-4-5-20250929",
    name: "Claude 4.5 Sonnet",
    providerId: "anthropic",
    maxOutputTokens: 16384,
    envVar: "ANTHROPIC_API_KEY",
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude 4.6 Sonnet",
    providerId: "anthropic",
    maxOutputTokens: 16384,
    envVar: "ANTHROPIC_API_KEY",
  },
  {
    id: "claude-opus-4-6",
    name: "Claude 4.6 Opus",
    providerId: "anthropic",
    maxOutputTokens: 16384,
    envVar: "ANTHROPIC_API_KEY",
  },
  {
    id: "gemini-3-pro-preview",
    name: "Gemini 3 Pro",
    providerId: "gemini",
    maxOutputTokens: 8192,
    envVar: "GEMINI_API_KEY",
  },
  {
    id: "gemini-3-flash-preview",
    name: "Gemini 3 Flash",
    providerId: "gemini",
    maxOutputTokens: 8192,
    envVar: "GEMINI_API_KEY",
  },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    providerId: "gemini",
    maxOutputTokens: 8192,
    envVar: "GEMINI_API_KEY",
  },
  {
    id: "gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro",
    providerId: "gemini",
    maxOutputTokens: 8192,
    envVar: "GEMINI_API_KEY",
  },
  {
    id: "moonshotai/kimi-k2.5",
    name: "Kimi K2.5",
    providerId: "moonshotai",
    maxOutputTokens: 8192,
    envVar: "OPEN_ROUTER_API_KEY",
  },
  {
    id: "z-ai/glm-5",
    name: "GLM-5",
    providerId: "zai",
    maxOutputTokens: 8192,
    envVar: "OPEN_ROUTER_API_KEY",
  },
];

export function getModelConfig(modelId: string): ModelConfig | undefined {
  return MODEL_CONFIGS.find((model) => model.id === modelId);
}

export function getModelsByProvider(): { providerId: ProviderId; providerName: string; models: ModelConfig[] }[] {
  const providers: Record<ProviderId, { providerId: ProviderId; providerName: string; models: ModelConfig[] }> = {
    openai: { providerId: "openai", providerName: "OpenAI", models: [] },
    anthropic: { providerId: "anthropic", providerName: "Anthropic", models: [] },
    gemini: { providerId: "gemini", providerName: "Google", models: [] },
    moonshotai: { providerId: "moonshotai", providerName: "Moonshot AI (OpenRouter)", models: [] },
    zai: { providerId: "zai", providerName: "Z.AI (OpenRouter)", models: [] },
  };

  for (const model of MODEL_CONFIGS) {
    providers[model.providerId].models.push(model);
  }

  return Object.values(providers).filter((provider) => provider.models.length > 0);
}
