// V4-10 (LLD_v4 §5, HLD_v4 ADR-21): EMBEDDING_TIER config selection —
// mirrors createModelAdapter.test.ts exactly, one tier removed of
// complexity (embeddings default conservatively to mock, never inferred
// from an unrelated key, since OPENAI_API_KEY points at OpenRouter, which
// has no embeddings endpoint — reusing it would silently fail).
import { describe, expect, it } from "vitest";
import { createEmbeddingAdapter, resolveEmbeddingTier } from "../../../src/adapters/createEmbeddingAdapter.js";
import { MockEmbeddingAdapter } from "../../../src/adapters/mockEmbedding.js";
import { EmbeddingHttpAdapter } from "../../../src/adapters/embeddingHttp.js";

describe("resolveEmbeddingTier", () => {
  it("defaults to mock when EMBEDDING_TIER is unset", () => {
    expect(resolveEmbeddingTier({})).toBe("mock");
  });

  it("does NOT infer hosted from OPENAI_API_KEY — that key points at OpenRouter, not an embeddings endpoint", () => {
    expect(resolveEmbeddingTier({ OPENAI_API_KEY: "sk-openrouter" })).toBe("mock");
  });

  it("infers hosted from EMBEDDINGS_API_KEY when EMBEDDING_TIER is unset", () => {
    expect(resolveEmbeddingTier({ EMBEDDINGS_API_KEY: "sk-embeddings" })).toBe("hosted");
  });

  it("honors an explicit EMBEDDING_TIER over inference", () => {
    expect(resolveEmbeddingTier({ EMBEDDING_TIER: "local", EMBEDDINGS_API_KEY: "sk-embeddings" })).toBe("local");
    expect(resolveEmbeddingTier({ EMBEDDING_TIER: "mock", EMBEDDINGS_API_KEY: "sk-embeddings" })).toBe("mock");
  });

  it("falls back to inference on an invalid EMBEDDING_TIER value", () => {
    expect(resolveEmbeddingTier({ EMBEDDING_TIER: "bogus" })).toBe("mock");
    expect(resolveEmbeddingTier({ EMBEDDING_TIER: "bogus", EMBEDDINGS_API_KEY: "sk-embeddings" })).toBe("hosted");
  });
});

describe("createEmbeddingAdapter", () => {
  it("returns MockEmbeddingAdapter for tier=mock", () => {
    expect(createEmbeddingAdapter({ EMBEDDING_TIER: "mock" })).toBeInstanceOf(MockEmbeddingAdapter);
  });

  it("returns EmbeddingHttpAdapter for tier=hosted, using EMBEDDINGS_API_KEY (never OPENAI_API_KEY)", () => {
    const adapter = createEmbeddingAdapter({
      EMBEDDING_TIER: "hosted",
      EMBEDDINGS_API_KEY: "sk-embeddings",
      OPENAI_API_KEY: "sk-openrouter",
    });
    expect(adapter).toBeInstanceOf(EmbeddingHttpAdapter);
  });

  it("throws for tier=hosted with no EMBEDDINGS_API_KEY, even if OPENAI_API_KEY is set", () => {
    expect(() => createEmbeddingAdapter({ EMBEDDING_TIER: "hosted", OPENAI_API_KEY: "sk-openrouter" })).toThrow(
      /API key/
    );
  });

  it("returns EmbeddingHttpAdapter pointed at localhost:11434 for tier=local, without requiring an API key", () => {
    const adapter = createEmbeddingAdapter({ EMBEDDING_TIER: "local" });
    expect(adapter).toBeInstanceOf(EmbeddingHttpAdapter);
  });
});
