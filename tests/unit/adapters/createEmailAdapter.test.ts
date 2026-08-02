// V5-15 (LLD_v5 §6, HLD_v5 ADR-29): EMAIL_TIER config selection — mirrors
// createEmbeddingAdapter.test.ts exactly.
import { describe, expect, it } from "vitest";
import { createEmailAdapter, resolveEmailTier } from "../../../src/adapters/createEmailAdapter.js";
import { MockEmailAdapter } from "../../../src/adapters/mockEmail.js";
import { EmailHttpAdapter } from "../../../src/adapters/emailHttp.js";

describe("resolveEmailTier", () => {
  it("defaults to mock when EMAIL_TIER is unset", () => {
    expect(resolveEmailTier({})).toBe("mock");
  });

  it("does NOT infer hosted from OPENAI_API_KEY or EMBEDDINGS_API_KEY", () => {
    expect(resolveEmailTier({ OPENAI_API_KEY: "sk-openrouter" })).toBe("mock");
    expect(resolveEmailTier({ EMBEDDINGS_API_KEY: "sk-embeddings" })).toBe("mock");
  });

  it("infers hosted from EMAIL_API_KEY when EMAIL_TIER is unset", () => {
    expect(resolveEmailTier({ EMAIL_API_KEY: "sk-email" })).toBe("hosted");
  });

  it("honors an explicit EMAIL_TIER over inference", () => {
    expect(resolveEmailTier({ EMAIL_TIER: "local", EMAIL_API_KEY: "sk-email" })).toBe("local");
    expect(resolveEmailTier({ EMAIL_TIER: "mock", EMAIL_API_KEY: "sk-email" })).toBe("mock");
  });

  it("falls back to inference on an invalid EMAIL_TIER value", () => {
    expect(resolveEmailTier({ EMAIL_TIER: "bogus" })).toBe("mock");
    expect(resolveEmailTier({ EMAIL_TIER: "bogus", EMAIL_API_KEY: "sk-email" })).toBe("hosted");
  });
});

describe("createEmailAdapter", () => {
  it("returns MockEmailAdapter for tier=mock", () => {
    expect(createEmailAdapter({ EMAIL_TIER: "mock" })).toBeInstanceOf(MockEmailAdapter);
  });

  it("returns EmailHttpAdapter for tier=hosted, using EMAIL_API_KEY (never OPENAI_API_KEY/EMBEDDINGS_API_KEY)", () => {
    const adapter = createEmailAdapter({
      EMAIL_TIER: "hosted",
      EMAIL_API_KEY: "sk-email",
      OPENAI_API_KEY: "sk-openrouter",
      EMBEDDINGS_API_KEY: "sk-embeddings",
    });
    expect(adapter).toBeInstanceOf(EmailHttpAdapter);
  });

  it("throws for tier=hosted with no EMAIL_API_KEY", () => {
    expect(() => createEmailAdapter({ EMAIL_TIER: "hosted" })).toThrow(/API key/);
  });

  it("returns EmailHttpAdapter pointed at localhost:8025 for tier=local, without requiring an API key", () => {
    const adapter = createEmailAdapter({ EMAIL_TIER: "local" });
    expect(adapter).toBeInstanceOf(EmailHttpAdapter);
  });
});
