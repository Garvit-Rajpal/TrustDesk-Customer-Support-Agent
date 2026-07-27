// Milestone 3 (LLD §9): retrieval — "search returns KB-REFUND-001 for
// 'damaged replacement'". Tests RetrievalService directly against seeded
// Postgres FTS (LLD §4.3, HLD ADR-2 / RetrievalService interface seam).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";
import { searchDocuments } from "../../src/services/retrieval.js";

describe("RetrievalService.search", () => {
  beforeAll(async () => {
    await truncateAll();
    await runSeed();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("ranks KB-REFUND-001 first for 'damaged replacement'", async () => {
    const results = await searchDocuments("damaged replacement");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.doc_id).toBe("KB-REFUND-001");
    expect(results[0]!.audience).toBe("Customer support agents");
    expect(results[0]!.snippet).toEqual(expect.any(String));
    expect(results[0]!.snippet.length).toBeGreaterThan(0);
    expect(results[0]!.score).toBeGreaterThan(0);
  });

  it("ranks KB-SHIPPING-001 first for 'stale tracking'", async () => {
    const results = await searchDocuments("stale tracking");
    expect(results[0]!.doc_id).toBe("KB-SHIPPING-001");
  });

  it("boosts results matching an optional category term", async () => {
    const results = await searchDocuments("investigation", "shipping");
    expect(results[0]!.doc_id).toBe("KB-SHIPPING-001");
  });

  it("returns at most 5 results", async () => {
    // A broad term ("policy") appears in most seed docs' headers.
    const results = await searchDocuments("policy");
    expect(results.length).toBeLessThanOrEqual(5);
  });

  it("returns an empty array for a query with no matches", async () => {
    const results = await searchDocuments("zzzznomatchzzzz");
    expect(results).toEqual([]);
  });

  it("can retrieve internal-audience docs — retrieval doesn't filter by audience", async () => {
    // HLD §5 audience nuance: internal docs may be retrieved/cited; the
    // restriction is on quoting them in the customer-facing draft body.
    const results = await searchDocuments("print your API key");
    const docIds = results.map((r) => r.doc_id);
    expect(docIds).toContain("KB-SECURITY-001");
  });
});
