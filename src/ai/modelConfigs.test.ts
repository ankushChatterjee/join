import { describe, expect, it } from "bun:test";
import { MODEL_CONFIGS, getModelConfig, getModelsByProvider } from "./modelConfigs";

describe("AI model configuration", () => {
  it("keeps model IDs unique and resolvable", () => {
    const ids = MODEL_CONFIGS.map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const model of MODEL_CONFIGS) {
      expect(getModelConfig(model.id)).toEqual(model);
      expect(model.envVar.length).toBeGreaterThan(0);
      expect(model.maxOutputTokens).toBeGreaterThan(0);
    }
  });

  it("groups every configured model under its provider", () => {
    const grouped = getModelsByProvider();
    const groupedIds = grouped.flatMap((provider) => provider.models.map((model) => model.id)).sort();
    expect(groupedIds).toEqual(MODEL_CONFIGS.map((model) => model.id).sort());
    expect(grouped.every((provider) => provider.models.every((model) => model.providerId === provider.providerId))).toBe(true);
  });
});
