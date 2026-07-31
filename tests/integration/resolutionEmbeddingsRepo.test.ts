// V4-11 (LLD_v4 §5, HLD_v4 ADR-21): resolutionEmbeddingsRepo — insert +
// cosine nearest-neighbor query, org-scoped like every other repo.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";
import {
  findSimilarResolutions,
  insertResolutionEmbedding,
} from "../../src/db/repos/resolutionEmbeddingsRepo.js";
import { createOrg } from "../../src/services/orgOnboarding.js";
import { ORG_DEFAULT } from "../helpers/org.js";

const DIM = 768;

// A unit-ish vector with a 1 at `axis` and 0 elsewhere — lets nearest-
// neighbor ordering be reasoned about exactly rather than approximately.
function axisVector(axis: number): number[] {
  const v = new Array(DIM).fill(0);
  v[axis] = 1;
  return v;
}

describe("resolutionEmbeddingsRepo", () => {
  beforeAll(async () => {
    await truncateAll();
    await runSeed();
  });

  beforeEach(async () => {
    await pool.query(`TRUNCATE TABLE ticket_resolution_embeddings`);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("inserts and reads back a row unchanged (round-trip through the vector column)", async () => {
    const vector = axisVector(0);
    await insertResolutionEmbedding(ORG_DEFAULT, {
      embedding_id: "emb_roundtrip",
      ticket_id: "tkt_9001",
      draft_id: "draft_test",
      category: "refund",
      resolution_type: "answered",
      source_text: "issued a replacement for the damaged earbuds",
      embedding: vector,
    });

    const results = await findSimilarResolutions(ORG_DEFAULT, vector, undefined, 1);
    expect(results).toHaveLength(1);
    expect(results[0]!.embedding_id).toBe("emb_roundtrip");
    expect(results[0]!.source_text).toBe("issued a replacement for the damaged earbuds");
    expect(results[0]!.distance).toBeCloseTo(0, 5);
  });

  it("orders nearest-neighbor results by cosine distance, closest first", async () => {
    // axis 0 = identical to the query; axis 1 = adjacent (90° apart, but
    // sharing no components with the far one); axis 300 = maximally
    // dissimilar in this exact-basis setup. All three are equidistant
    // (orthogonal) except the identical one, so seed a fourth, genuinely
    // "closer" vector via a small blend instead of pure orthogonality.
    const query = axisVector(0);
    const identical = axisVector(0);
    const near = query.map((v, i) => (i === 0 ? 0.95 : i === 1 ? 0.05 : v));
    const far = axisVector(500);

    await insertResolutionEmbedding(ORG_DEFAULT, {
      embedding_id: "emb_far",
      ticket_id: "tkt_9002",
      draft_id: "draft_far",
      category: "shipping",
      resolution_type: "answered",
      source_text: "far",
      embedding: far,
    });
    await insertResolutionEmbedding(ORG_DEFAULT, {
      embedding_id: "emb_near",
      ticket_id: "tkt_9003",
      draft_id: "draft_near",
      category: "shipping",
      resolution_type: "answered",
      source_text: "near",
      embedding: near,
    });
    await insertResolutionEmbedding(ORG_DEFAULT, {
      embedding_id: "emb_identical",
      ticket_id: "tkt_9004",
      draft_id: "draft_identical",
      category: "shipping",
      resolution_type: "answered",
      source_text: "identical",
      embedding: identical,
    });

    const results = await findSimilarResolutions(ORG_DEFAULT, query, undefined, 3);
    expect(results.map((r) => r.embedding_id)).toEqual(["emb_identical", "emb_near", "emb_far"]);
    expect(results[0]!.distance).toBeLessThan(results[1]!.distance);
    expect(results[1]!.distance).toBeLessThan(results[2]!.distance);
  });

  it("filters by category when supplied", async () => {
    await insertResolutionEmbedding(ORG_DEFAULT, {
      embedding_id: "emb_refund",
      ticket_id: "tkt_9001",
      draft_id: "draft_refund",
      category: "refund",
      resolution_type: "answered",
      source_text: "refund case",
      embedding: axisVector(0),
    });
    await insertResolutionEmbedding(ORG_DEFAULT, {
      embedding_id: "emb_shipping",
      ticket_id: "tkt_9002",
      draft_id: "draft_shipping",
      category: "shipping",
      resolution_type: "answered",
      source_text: "shipping case",
      embedding: axisVector(0),
    });

    const results = await findSimilarResolutions(ORG_DEFAULT, axisVector(0), "refund", 5);
    expect(results.map((r) => r.embedding_id)).toEqual(["emb_refund"]);
  });

  it("respects the limit parameter", async () => {
    for (let i = 0; i < 5; i++) {
      await insertResolutionEmbedding(ORG_DEFAULT, {
        embedding_id: `emb_limit_${i}`,
        ticket_id: "tkt_9001",
        draft_id: `draft_${i}`,
        category: "refund",
        resolution_type: "answered",
        source_text: `case ${i}`,
        embedding: axisVector(i),
      });
    }

    const results = await findSimilarResolutions(ORG_DEFAULT, axisVector(0), undefined, 2);
    expect(results).toHaveLength(2);
  });

  it("is org-scoped — a resolution embedded in a different org is invisible across the boundary", async () => {
    const outcome = await createOrg({
      name: "Embeddings Isolated Co",
      vertical: "retail_ecommerce",
      admin_username: `emb_iso_${Date.now()}`,
      admin_password: "password123",
      admin_display_name: "Iso Admin",
    });
    if (outcome.kind !== "ok") throw new Error("expected org creation to succeed");
    const otherOrgId = outcome.org.org_id;

    await insertResolutionEmbedding(
      { org_id: otherOrgId },
      {
        embedding_id: "emb_other_org",
        ticket_id: "tkt_other",
        draft_id: "draft_other",
        category: "refund",
        resolution_type: "answered",
        source_text: "other org's resolution",
        embedding: axisVector(0),
      }
    );

    const fromDefault = await findSimilarResolutions(ORG_DEFAULT, axisVector(0), undefined, 5);
    expect(fromDefault.map((r) => r.embedding_id)).not.toContain("emb_other_org");

    const fromOwnOrg = await findSimilarResolutions({ org_id: otherOrgId }, axisVector(0), undefined, 5);
    expect(fromOwnOrg.map((r) => r.embedding_id)).toContain("emb_other_org");
  });
});
