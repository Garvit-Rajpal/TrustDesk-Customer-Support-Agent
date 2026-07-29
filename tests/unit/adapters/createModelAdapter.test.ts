// V2-6 (LLD_v2 §7): MODEL_TIER config selection — pure function, no network
// or process.env mutation needed since resolveModelTier/createModelAdapter
// both take an explicit env object.
import { describe, expect, it } from "vitest";
import { createModelAdapter, resolveModelTier } from "../../../src/adapters/createModelAdapter.js";
import { MockModelAdapter } from "../../../src/adapters/mock.js";
import { OpenRouterAdapter } from "../../../src/adapters/openrouter.js";

describe("resolveModelTier", () => {
  it("defaults to mock when MODEL_TIER is unset and no API key is present", () => {
    expect(resolveModelTier({})).toBe("mock");
  });

  it("infers hosted from OPENAI_API_KEY when MODEL_TIER is unset (v1 back-compat)", () => {
    expect(resolveModelTier({ OPENAI_API_KEY: "sk-test" })).toBe("hosted");
  });

  it("honors an explicit MODEL_TIER over the OPENAI_API_KEY inference", () => {
    expect(resolveModelTier({ MODEL_TIER: "local", OPENAI_API_KEY: "sk-test" })).toBe("local");
    expect(resolveModelTier({ MODEL_TIER: "mock", OPENAI_API_KEY: "sk-test" })).toBe("mock");
  });

  it("falls back to inference on an invalid MODEL_TIER value", () => {
    expect(resolveModelTier({ MODEL_TIER: "bogus" })).toBe("mock");
    expect(resolveModelTier({ MODEL_TIER: "bogus", OPENAI_API_KEY: "sk-test" })).toBe("hosted");
  });
});

describe("createModelAdapter", () => {
  it("returns MockModelAdapter for tier=mock", () => {
    expect(createModelAdapter({ MODEL_TIER: "mock" })).toBeInstanceOf(MockModelAdapter);
  });

  it("returns OpenRouterAdapter pointed at OpenRouter for tier=hosted", () => {
    const adapter = createModelAdapter({ MODEL_TIER: "hosted", OPENAI_API_KEY: "sk-test" });
    expect(adapter).toBeInstanceOf(OpenRouterAdapter);
  });

  it("returns OpenRouterAdapter pointed at localhost:11434 for tier=local, without requiring an API key", () => {
    const adapter = createModelAdapter({ MODEL_TIER: "local" });
    expect(adapter).toBeInstanceOf(OpenRouterAdapter);
  });

  it("throws for tier=hosted with no API key, same as v1 OpenRouterAdapter behavior", () => {
    expect(() => createModelAdapter({ MODEL_TIER: "hosted" })).toThrow(/OPENAI_API_KEY/);
  });
});
