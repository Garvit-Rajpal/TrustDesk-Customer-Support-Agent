// V4-10 (LLD_v4 §5, HLD_v4 ADR-21): deterministic fake vectors — used in
// every test per LLD v1 §1's MockModelAdapter-in-tests rule, extended to
// embeddings, so similarity-ordering assertions are reproducible.
import { describe, expect, it } from "vitest";
import { MockEmbeddingAdapter } from "../../../src/adapters/mockEmbedding.js";

describe("MockEmbeddingAdapter", () => {
  it("produces a 768-dimension vector", async () => {
    const adapter = new MockEmbeddingAdapter();
    const vector = await adapter.embed("damaged replacement earbuds");
    expect(vector).toHaveLength(768);
    expect(vector.every((n) => typeof n === "number" && Number.isFinite(n))).toBe(true);
  });

  it("is deterministic — the same text always produces the same vector", async () => {
    const adapter = new MockEmbeddingAdapter();
    const a = await adapter.embed("refund request for a broken tablet");
    const b = await adapter.embed("refund request for a broken tablet");
    expect(a).toEqual(b);
  });

  it("produces distinct vectors for distinct text", async () => {
    const adapter = new MockEmbeddingAdapter();
    const a = await adapter.embed("refund request for a broken tablet");
    const b = await adapter.embed("shipping delay on a wearable order");
    expect(a).not.toEqual(b);
  });
});
