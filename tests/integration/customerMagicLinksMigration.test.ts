// V5-17 (LLD_v5 §1/§6, HLD_v5 ADR-29): customer_magic_links table migration
// — asserting the schema actually exists in the running test DB, same
// pattern pgvectorMigration.test.ts established.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";

describe("customer_magic_links migration (V5-17)", () => {
  beforeAll(async () => {
    await truncateAll();
    await runSeed();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("customer_magic_links exists with the expected columns", async () => {
    const { rows: columns } = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'customer_magic_links' ORDER BY ordinal_position`
    );
    expect(columns.map((c) => c.column_name)).toEqual([
      "link_id",
      "org_id",
      "customer_id",
      "ticket_id",
      "token_hash",
      "expires_at",
      "consumed_at",
      "created_at",
    ]);
  });

  it("has a unique index on token_hash and a lookup index on (customer_id, created_at)", async () => {
    const { rows: indexes } = await pool.query(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'customer_magic_links'`
    );
    expect(indexes.some((i) => i.indexdef.includes("token_hash") && i.indexdef.includes("UNIQUE"))).toBe(true);
    expect(indexes.some((i) => i.indexdef.includes("customer_id") && i.indexdef.includes("created_at"))).toBe(true);
  });

  it("rejects a duplicate token_hash", async () => {
    await pool.query(
      `INSERT INTO customer_magic_links (link_id, org_id, customer_id, token_hash, expires_at)
       VALUES ('mlk_test_1', 'org_default', 'cus_1001', 'hash-a', now() + interval '15 minutes')`
    );
    await expect(
      pool.query(
        `INSERT INTO customer_magic_links (link_id, org_id, customer_id, token_hash, expires_at)
         VALUES ('mlk_test_2', 'org_default', 'cus_1001', 'hash-a', now() + interval '15 minutes')`
      )
    ).rejects.toThrow();
    await pool.query(`DELETE FROM customer_magic_links WHERE link_id = 'mlk_test_1'`);
  });
});
