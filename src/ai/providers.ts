// ============================================================================
// AI Providers - Vercel AI SDK Provider Instances
// ============================================================================

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { invoke } from "@tauri-apps/api/core";
import { getModelConfig } from "./modelConfigs";
export { MODEL_CONFIGS, getModelConfig, getModelsByProvider } from "./modelConfigs";

// --- Provider Instance Cache ---

// Cache provider instances keyed by "providerId:apiKey" to avoid recreating them
const providerCache = new Map<
  string,
  | ReturnType<typeof createAnthropic>
  | ReturnType<typeof createGoogleGenerativeAI>
  | ReturnType<typeof createOpenAI>
  | ReturnType<typeof createOpenRouter>
>();

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

  if (config.providerId === "openai") {
    let provider = providerCache.get(cacheKey) as ReturnType<typeof createOpenAI> | undefined;
    if (!provider) {
      provider = createOpenAI({
        apiKey,
        fetch: tauriFetch as unknown as typeof globalThis.fetch,
      });
      providerCache.set(cacheKey, provider);
    }
    return provider(modelId);
  }

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
