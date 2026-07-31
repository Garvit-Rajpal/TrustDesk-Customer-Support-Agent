// V4-17 (LLD_v4 §6, HLD_v4 ADR-22): tool-execution-time guardrail. Re-runs
// outputScan's checkActionValidity-equivalent checks (tool still in
// catalog, payload still has catalog-required fields) plus one
// execute-time-only fact: the ticket hasn't since moved to a terminal
// status. Needs real catalog/ticket rows, so this is integration-style
// (same convention as toolActions.test.ts) rather than a pure unit test.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";
import { toolExecutionScan } from "../../src/services/guardrails/toolExecutionScan.js";
import { insertToolAction, type ToolActionRow } from "../../src/db/repos/toolActionsRepo.js";
import { newActionId } from "../../src/domain/ids.js";
import { updateTicketStatus } from "../../src/db/repos/ticketsRepo.js";
import { ORG_DEFAULT } from "../helpers/org.js";

beforeEach(async () => {
  await truncateAll();
  await runSeed();
});

afterAll(async () => {
  await pool.end();
});

async function makeAction(overrides: Partial<{
  ticket_id: string;
  tool_name: string;
  payload: Record<string, unknown>;
}> = {}): Promise<ToolActionRow> {
  return insertToolAction(ORG_DEFAULT, {
    action_id: newActionId(),
    ticket_id: overrides.ticket_id ?? "tkt_9001",
    tool_name: overrides.tool_name ?? "create_replacement_order",
    payload: overrides.payload ?? { order_id: "ord_5001", sku: "SKU-1", reason: "damaged", idempotency_key: "idem_1" },
    risk_level: "medium",
    requires_human_approval: true,
    status: "approved",
    idempotency_key: overrides.payload?.idempotency_key as string | undefined ?? "idem_1",
  });
}

describe("toolExecutionScan", () => {
  it("passes for a catalog-valid action on a still-open (non-terminal) ticket", async () => {
    const action = await makeAction();
    const result = await toolExecutionScan(ORG_DEFAULT, action);
    expect(result).toMatchObject({ layer: "tool_execution", passed: true });
  });

  // Note: "tool removed from catalog after being requested" isn't
  // constructible as a test fixture — tool_actions.tool_name carries a FK
  // to tool_catalog, and tool_catalog rows are static seed data never
  // deleted by this app. The catalog-existence check in toolExecutionScan
  // is kept anyway as defense-in-depth / symmetry with outputScan's
  // checkActionValidity, in case that assumption ever changes.

  it("fails when the payload is missing a catalog-required field", async () => {
    // create_replacement_order requires order_id, sku, reason, idempotency_key.
    const action = await makeAction({ payload: { order_id: "ord_5001", idempotency_key: "idem_2" } });
    const result = await toolExecutionScan(ORG_DEFAULT, action);
    expect(result.passed).toBe(false);
    expect(result.detail).toMatch(/missing required fields/);
  });

  it("fails when the ticket has since moved to a terminal status (resolved)", async () => {
    const action = await makeAction();
    await updateTicketStatus(ORG_DEFAULT, "tkt_9001", "resolved");
    const result = await toolExecutionScan(ORG_DEFAULT, action);
    expect(result.passed).toBe(false);
    expect(result.detail).toMatch(/resolved/);
  });

  it("fails when the ticket has since moved to a terminal status (closed)", async () => {
    const action = await makeAction();
    await updateTicketStatus(ORG_DEFAULT, "tkt_9001", "closed");
    const result = await toolExecutionScan(ORG_DEFAULT, action);
    expect(result.passed).toBe(false);
    expect(result.detail).toMatch(/closed/);
  });
});
