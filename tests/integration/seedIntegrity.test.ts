// Milestone 1 (LLD §9): seed integrity — row counts, doc IDs preserved
// verbatim, expected labels landing only in ticket_expected_labels.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";
import { getTicketById } from "../../src/db/repos/ticketsRepo.js";
import { getExpectedLabels } from "../../src/db/repos/expectedLabelsRepo.js";
import { ORG_DEFAULT } from "../helpers/org.js";

describe("seed loader integrity", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("loads the expected row counts for every seed entity", async () => {
    const summary = await runSeed();

    expect(summary.customers).toBe(6);
    // V4-2 (LLD_v4 §2): orders.json expanded to 24 orders across the 6 seed
    // customers so ad-hoc demo tickets have a believable order history.
    // ord_5001-ord_5006 are unchanged verbatim.
    expect(summary.orders).toBe(24);
    expect(summary.tickets).toBe(8);
    expect(summary.kbDocuments).toBe(8);
    expect(summary.toolCatalog).toBe(6);

    const counts = await Promise.all(
      [
        "customers",
        "orders",
        "tickets",
        "kb_documents",
        "tool_catalog",
        "ticket_expected_labels",
      ].map(async (table) => {
        const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${table}`);
        return [table, rows[0].n] as const;
      })
    );
    const byTable = Object.fromEntries(counts);
    expect(byTable.customers).toBe(6);
    expect(byTable.orders).toBe(24);
    expect(byTable.tickets).toBe(8);
    expect(byTable.kb_documents).toBe(8);
    expect(byTable.tool_catalog).toBe(6);
    expect(byTable.ticket_expected_labels).toBe(8);
  });

  it("preserves seed IDs verbatim (doc_id, ticket_id)", async () => {
    await runSeed();

    const { rows: docRows } = await pool.query(
      `SELECT doc_id FROM kb_documents WHERE doc_id = $1`,
      ["KB-REFUND-001"]
    );
    expect(docRows).toHaveLength(1);

    const { rows: adversarialRows } = await pool.query(
      `SELECT doc_id FROM kb_documents WHERE doc_id = $1`,
      ["KB-ADVERSARIAL-001"]
    );
    expect(adversarialRows).toHaveLength(1);

    const ticket = await getTicketById(ORG_DEFAULT, "tkt_9001");
    expect(ticket?.ticket_id).toBe("tkt_9001");
  });

  it("keeps expected labels out of the runtime ticket row", async () => {
    await runSeed();

    const ticket = await getTicketById(ORG_DEFAULT, "tkt_9001");
    expect(ticket).not.toHaveProperty("expected_category");
    expect(ticket).not.toHaveProperty("expected_actions");

    const labels = await getExpectedLabels("tkt_9001");
    expect(labels?.expected_category).toBe("refund");
    expect(labels?.expected_priority).toBe("medium");
    expect(labels?.expected_sentiment).toBe("frustrated");
    expect(labels?.expected_escalation).toBe(false);
    expect(labels?.expected_actions).toEqual(["create_replacement_order"]);
  });

  it("is idempotent — re-running the seed loader does not duplicate rows", async () => {
    await runSeed();
    const summary = await runSeed();

    expect(summary.customers).toBe(6);

    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM tickets`);
    expect(rows[0].n).toBe(8);
  });
});
