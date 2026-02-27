// ============================================================================
// AI Providers - Vercel AI SDK Provider Instances
// ============================================================================

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { invoke } from "@tauri-apps/api/core";
// --- Model Configuration ---

export type ProviderId = "anthropic" | "gemini" | "moonshotai" | "zai";

export interface ModelConfig {
  id: string;
  name: string;
  providerId: ProviderId;
  maxOutputTokens: number;
  envVar: string;
}

export const MODEL_CONFIGS: ModelConfig[] = [
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
  return MODEL_CONFIGS.find((m) => m.id === modelId);
}

export function getModelsByProvider(): { providerId: ProviderId; providerName: string; models: ModelConfig[] }[] {
  const providers: Record<ProviderId, { providerId: ProviderId; providerName: string; models: ModelConfig[] }> = {
    anthropic: { providerId: "anthropic", providerName: "Anthropic", models: [] },
    gemini: { providerId: "gemini", providerName: "Google", models: [] },
    moonshotai: { providerId: "moonshotai", providerName: "Moonshot AI (OpenRouter)", models: [] },
    zai: { providerId: "zai", providerName: "Z.AI (OpenRouter)", models: [] },
  };

  for (const model of MODEL_CONFIGS) {
    providers[model.providerId].models.push(model);
  }

  return Object.values(providers).filter((p) => p.models.length > 0);
}

// --- Provider Instance Cache ---

// Cache provider instances keyed by "providerId:apiKey" to avoid recreating them
const providerCache = new Map<string, ReturnType<typeof createAnthropic> | ReturnType<typeof createGoogleGenerativeAI> | ReturnType<typeof createOpenRouter>>();

/**
 * Get a Vercel AI SDK language model instance for the given model ID.
 * Lazily fetches the API key from the Tauri backend and creates the provider.
 */
export async function getModel(modelId: string) {
  const config = getModelConfig(modelId);
  if (!config) {
    throw new Error(`Unknown model: ${modelId}`);
  }

  // Fetch API key from backend
  let apiKey: string;
  try {
    apiKey = await invoke<string>("get_env_var", { name: config.envVar });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `API key not configured. Please set the ${config.envVar} environment variable and restart the app. (${msg})`
    );
  }

  if (!apiKey) {
    throw new Error(
      `API key is empty. Please set the ${config.envVar} environment variable and restart the app.`
    );
  }

  const cacheKey = `${config.providerId}:${apiKey}`;

  if (config.providerId === "anthropic") {
    let provider = providerCache.get(cacheKey) as ReturnType<typeof createAnthropic> | undefined;
    if (!provider) {
      provider = createAnthropic({
        apiKey,
        fetch: tauriFetch as unknown as typeof globalThis.fetch,
        headers: {
          "anthropic-dangerous-direct-browser-access": "true",
        },
      });
      providerCache.set(cacheKey, provider);
    }
    return provider(modelId);
  }

  if (config.providerId === "gemini") {
    let provider = providerCache.get(cacheKey) as ReturnType<typeof createGoogleGenerativeAI> | undefined;
    if (!provider) {
      provider = createGoogleGenerativeAI({
        apiKey,
        fetch: tauriFetch as unknown as typeof globalThis.fetch,
      });
      providerCache.set(cacheKey, provider);
    }
    return provider(modelId);
  }

  if (config.providerId === "moonshotai" || config.providerId === "zai") {
    let provider = providerCache.get(cacheKey) as ReturnType<typeof createOpenRouter> | undefined;
    if (!provider) {
      provider = createOpenRouter({
        apiKey,
        fetch: tauriFetch as unknown as typeof globalThis.fetch,
      });
      providerCache.set(cacheKey, provider);
    }
    return provider(modelId);
  }

  throw new Error(`Unknown provider: ${config.providerId}`);
}
