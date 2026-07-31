// V4-9 (LLD_v4 §1/§5, HLD_v4 ADR-21): pgvector extension + the
// ticket_resolution_embeddings table migration. Not testing node-pg-migrate
// itself — asserting the schema this migration is supposed to produce
// actually exists in the running test DB, same way every other migration
// in this codebase is implicitly verified by the tests that depend on its
// tables (no other migration file has a dedicated test either).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";

describe("pgvector migration (V4-9)", () => {
  beforeAll(async () => {
    await truncateAll();
    await runSeed();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("the vector extension is installed", async () => {
    const { rows } = await pool.query(`SELECT extname FROM pg_extension WHERE extname = 'vector'`);
    expect(rows).toHaveLength(1);
  });

  it("ticket_resolution_embeddings exists, org-scoped, with an ivfflat cosine index", async () => {
    const { rows: columns } = await pool.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = 'ticket_resolution_embeddings' ORDER BY ordinal_position`
    );
    expect(columns.map((c) => c.column_name)).toEqual([
      "embedding_id",
      "org_id",
      "ticket_id",
      "draft_id",
      "category",
      "resolution_type",
      "source_text",
      "embedding",
      "created_at",
    ]);

    const { rows: indexes } = await pool.query(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'ticket_resolution_embeddings'`
    );
    expect(indexes.some((i) => i.indexdef.includes("ivfflat") && i.indexdef.includes("vector_cosine_ops"))).toBe(
      true
    );
    expect(indexes.some((i) => i.indexdef.includes("org_id"))).toBe(true);
  });

  it("accepts a 768-dimension vector insert and rejects a mismatched dimension", async () => {
    const orgResult = await pool.query(`SELECT org_id FROM orgs WHERE org_id = 'org_default'`);
    expect(orgResult.rows).toHaveLength(1);

    const goodVector = `[${Array(768).fill(0).join(",")}]`;
    await pool.query(
      `INSERT INTO ticket_resolution_embeddings
         (embedding_id, org_id, ticket_id, draft_id, category, resolution_type, source_text, embedding)
       VALUES ('emb_test_1', 'org_default', 'tkt_test', 'draft_test', 'refund', 'answered', 'test', $1)`,
      [goodVector]
    );

    const badVector = `[${Array(3).fill(0).join(",")}]`;
    await expect(
      pool.query(
        `INSERT INTO ticket_resolution_embeddings
           (embedding_id, org_id, ticket_id, draft_id, category, resolution_type, source_text, embedding)
         VALUES ('emb_test_2', 'org_default', 'tkt_test', 'draft_test', 'refund', 'answered', 'test', $1)`,
        [badVector]
      )
    ).rejects.toThrow();

    await pool.query(`DELETE FROM ticket_resolution_embeddings WHERE embedding_id = 'emb_test_1'`);
  });
});
