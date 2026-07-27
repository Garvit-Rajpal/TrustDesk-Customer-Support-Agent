// Milestone 7 (LLD §9): tool actions — validation ladder, state machine
// illegal transitions, idempotent replay, re-validation at execute.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";
import { getTicketById, updateTicketTriage, insertTicket } from "../../src/db/repos/ticketsRepo.js";
import { decideToolAction, executeToolAction, requestToolAction } from "../../src/services/toolActions.js";
import { newTicketId } from "../../src/domain/ids.js";
import { getUserByUsername } from "../../src/db/repos/usersRepo.js";

async function triagedTicket(ticketId: string, category: string) {
  await updateTicketTriage(ticketId, {
    category: category as never,
    priority: "medium",
    sentiment: "frustrated",
    should_escalate: false,
    reason_summary: "x",
  });
  return (await getTicketById(ticketId))!;
}

// approvals.reviewer_id is a real FK to users — reject/approve tests need a
// seeded user id, not an arbitrary string.
let reviewerId: string;

beforeAll(async () => {
  await truncateAll();
  await runSeed();
  const reviewer = await getUserByUsername("agent1");
  reviewerId = reviewer!.user_id;
});

afterAll(async () => {
  await pool.end();
});

describe("ToolActionService.requestToolAction — validation ladder", () => {
  it("rejects an unknown tool", async () => {
    const ticket = await triagedTicket("tkt_9001", "refund");
    const outcome = await requestToolAction(ticket, "delete_everything", {});
    expect(outcome.kind).toBe("invalid");
  });

  it("rejects a request missing required fields", async () => {
    const ticket = await triagedTicket("tkt_9001", "refund");
    const outcome = await requestToolAction(ticket, "create_replacement_order", {
      order_id: "ord_5001",
      // missing sku, reason, idempotency_key
    });
    expect(outcome.kind).toBe("invalid");
    if (outcome.kind === "invalid") {
      expect(outcome.message).toMatch(/sku/);
    }
  });

  it("rejects an untriaged ticket", async () => {
    const freshId = newTicketId();
    await insertTicket({
      ticket_id: freshId,
      customer_id: "cus_1001",
      order_id: "ord_5001",
      channel: "email",
      subject: "x",
      body: "y",
      created_at: new Date().toISOString(),
    });
    const ticket = (await getTicketById(freshId))!;
    const outcome = await requestToolAction(ticket, "create_replacement_order", {
      order_id: "ord_5001",
      sku: "BG-AIRPODS-01",
      reason: "damaged",
      idempotency_key: `${freshId}-replacement-1`,
    });
    expect(outcome.kind).toBe("invalid");
    if (outcome.kind === "invalid") expect(outcome.message).toMatch(/triaged/);
  });

  it("rejects a tool not allowed for the ticket's category", async () => {
    const ticket = await triagedTicket("tkt_9001", "shipping"); // create_replacement_order needs refund/warranty
    const outcome = await requestToolAction(ticket, "create_replacement_order", {
      order_id: "ord_5001",
      sku: "BG-AIRPODS-01",
      reason: "damaged",
      idempotency_key: "tkt_9001-replacement-1",
    });
    expect(outcome.kind).toBe("invalid");
    if (outcome.kind === "invalid") expect(outcome.message).toMatch(/category/);
  });

  it("rejects an amount over max_amount_inr", async () => {
    const ticket = await triagedTicket("tkt_9006", "general");
    const outcome = await requestToolAction(ticket, "issue_coupon", {
      customer_id: "cus_1006",
      amount: 5000,
      reason: "goodwill",
      idempotency_key: "tkt_9006-coupon-1",
    });
    expect(outcome.kind).toBe("invalid");
    if (outcome.kind === "invalid") expect(outcome.message).toMatch(/max_amount_inr/);
  });

  it("accepts an amount at or under max_amount_inr", async () => {
    const ticket = await triagedTicket("tkt_9006", "general");
    const outcome = await requestToolAction(ticket, "issue_coupon", {
      customer_id: "cus_1006",
      amount: 1000,
      reason: "goodwill",
      idempotency_key: "tkt_9006-coupon-2",
    });
    expect(outcome.kind).toBe("created");
  });

  it("creates with status approval_required when the catalog requires it", async () => {
    const ticket = await triagedTicket("tkt_9001", "refund");
    const outcome = await requestToolAction(ticket, "create_replacement_order", {
      order_id: "ord_5001",
      sku: "BG-AIRPODS-01",
      reason: "damaged",
      idempotency_key: "tkt_9001-replacement-1",
    });
    expect(outcome.kind).toBe("created");
    if (outcome.kind === "created") expect(outcome.action.status).toBe("approval_required");
  });

  it("creates with status approved (auto) when the catalog does not require approval", async () => {
    const ticket = await triagedTicket("tkt_9002", "shipping");
    const outcome = await requestToolAction(ticket, "open_carrier_investigation", {
      order_id: "ord_5002",
      tracking_number: "BLUETRK10002",
      reason: "stale tracking",
      idempotency_key: "tkt_9002-investigation-1",
    });
    expect(outcome.kind).toBe("created");
    if (outcome.kind === "created") expect(outcome.action.status).toBe("approved");
  });

  it("replays on a repeated idempotency_key instead of creating a duplicate", async () => {
    const ticket = await triagedTicket("tkt_9001", "refund");
    const payload = {
      order_id: "ord_5001",
      sku: "BG-AIRPODS-01",
      reason: "damaged",
      idempotency_key: "tkt_9001-replacement-idem-test",
    };
    const first = await requestToolAction(ticket, "create_replacement_order", payload);
    const second = await requestToolAction(ticket, "create_replacement_order", payload);

    expect(first.kind).toBe("created");
    expect(second.kind).toBe("replayed");
    if (first.kind === "created" && second.kind === "replayed") {
      expect(second.action.action_id).toBe(first.action.action_id);
    }

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM tool_actions WHERE idempotency_key = $1`,
      [payload.idempotency_key]
    );
    expect(rows[0].n).toBe(1);
  });
});

describe("ToolActionService — approve/reject state machine", () => {
  async function createApprovalRequiredAction(key: string) {
    const ticket = await triagedTicket("tkt_9001", "refund");
    const outcome = await requestToolAction(ticket, "create_replacement_order", {
      order_id: "ord_5001",
      sku: "BG-AIRPODS-01",
      reason: "damaged",
      idempotency_key: key,
    });
    if (outcome.kind !== "created") throw new Error("fixture setup failed");
    return outcome.action;
  }

  it("approves from approval_required", async () => {
    const action = await createApprovalRequiredAction("tkt_9001-replacement-a1");
    const outcome = await decideToolAction(action.action_id, reviewerId, "looks good", "approved");
    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") expect(outcome.action.status).toBe("approved");
  });

  it("rejects from approval_required, terminally", async () => {
    const action = await createApprovalRequiredAction("tkt_9001-replacement-a2");
    const outcome = await decideToolAction(action.action_id, reviewerId, "not eligible", "rejected");
    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") expect(outcome.action.status).toBe("rejected");

    // Terminal: a second decision on a rejected action is illegal.
    const second = await decideToolAction(action.action_id, reviewerId, "changed my mind", "approved");
    expect(second.kind).toBe("illegal_transition");
  });

  it("404s (not_found) for an unknown action id", async () => {
    const outcome = await decideToolAction("act_does_not_exist", reviewerId, "x", "approved");
    expect(outcome.kind).toBe("not_found");
  });

  it("cannot approve an already-approved action", async () => {
    const action = await createApprovalRequiredAction("tkt_9001-replacement-a3");
    await decideToolAction(action.action_id, reviewerId, "ok", "approved");
    const second = await decideToolAction(action.action_id, reviewerId, "ok again", "approved");
    expect(second.kind).toBe("illegal_transition");
    if (second.kind === "illegal_transition") expect(second.from).toBe("approved");
  });

  it("cannot approve/reject an auto-approved action (never entered approval_required)", async () => {
    const ticket = await triagedTicket("tkt_9002", "shipping");
    const created = await requestToolAction(ticket, "open_carrier_investigation", {
      order_id: "ord_5002",
      tracking_number: "BLUETRK10002",
      reason: "stale tracking",
      idempotency_key: "tkt_9002-investigation-approve-test",
    });
    if (created.kind !== "created") throw new Error("fixture setup failed");
    const outcome = await decideToolAction(created.action.action_id, reviewerId, "x", "approved");
    expect(outcome.kind).toBe("illegal_transition");
  });
});

describe("ToolActionService.executeToolAction — execute + re-validation", () => {
  it("404s (not_found) for an unknown action id", async () => {
    const outcome = await executeToolAction("act_does_not_exist");
    expect(outcome.kind).toBe("not_found");
  });

  it("cannot execute from approval_required (must be approved first)", async () => {
    const ticket = await triagedTicket("tkt_9001", "refund");
    const created = await requestToolAction(ticket, "create_replacement_order", {
      order_id: "ord_5001",
      sku: "BG-AIRPODS-01",
      reason: "damaged",
      idempotency_key: "tkt_9001-execute-illegal",
    });
    if (created.kind !== "created") throw new Error("fixture setup failed");
    const outcome = await executeToolAction(created.action.action_id);
    expect(outcome.kind).toBe("illegal_transition");
  });

  it("cannot execute a rejected action", async () => {
    const ticket = await triagedTicket("tkt_9001", "refund");
    const created = await requestToolAction(ticket, "create_replacement_order", {
      order_id: "ord_5001",
      sku: "BG-AIRPODS-01",
      reason: "damaged",
      idempotency_key: "tkt_9001-execute-rejected",
    });
    if (created.kind !== "created") throw new Error("fixture setup failed");
    await decideToolAction(created.action.action_id, reviewerId, "no", "rejected");
    const outcome = await executeToolAction(created.action.action_id);
    expect(outcome.kind).toBe("illegal_transition");
  });

  it("executes an approved, eligible action and stores a mock execution result", async () => {
    const ticket = await triagedTicket("tkt_9001", "refund"); // within return window
    const created = await requestToolAction(ticket, "create_replacement_order", {
      order_id: "ord_5001",
      sku: "BG-AIRPODS-01",
      reason: "damaged",
      idempotency_key: "tkt_9001-execute-happy",
    });
    if (created.kind !== "created") throw new Error("fixture setup failed");
    await decideToolAction(created.action.action_id, reviewerId, "ok", "approved");

    const outcome = await executeToolAction(created.action.action_id);
    expect(outcome.kind).toBe("executed");
    if (outcome.kind === "executed") {
      expect(outcome.action.status).toBe("executed");
      expect(outcome.action.execution_result).toHaveProperty("replacement_order_id");
    }
  });

  it("replays on re-execution of an already-executed action", async () => {
    const ticket = await triagedTicket("tkt_9001", "refund");
    const created = await requestToolAction(ticket, "create_replacement_order", {
      order_id: "ord_5001",
      sku: "BG-AIRPODS-01",
      reason: "damaged",
      idempotency_key: "tkt_9001-execute-replay",
    });
    if (created.kind !== "created") throw new Error("fixture setup failed");
    await decideToolAction(created.action.action_id, reviewerId, "ok", "approved");
    const first = await executeToolAction(created.action.action_id);
    const second = await executeToolAction(created.action.action_id);

    expect(first.kind).toBe("executed");
    expect(second.kind).toBe("replayed");
    if (first.kind === "executed" && second.kind === "replayed") {
      expect(second.action.execution_result).toEqual(first.action.execution_result);
    }
  });

  it("fails execution when eligibility re-validation catches an expired window (defense in depth)", async () => {
    // A ticket created long after both the 7-day return window and the
    // 12-month warranty have lapsed for its order — nothing in the request
    // ladder checks this (it's not eligibility-aware), only execute does.
    const staleTicketId = newTicketId();
    await insertTicket({
      ticket_id: staleTicketId,
      customer_id: "cus_1003",
      order_id: "ord_5003", // delivered 2026-06-14, return window ends 2026-06-21
      channel: "email",
      subject: "Very late replacement ask",
      body: "Please replace this old order.",
      created_at: "2028-01-01T00:00:00Z",
    });
    const ticket = await triagedTicket(staleTicketId, "refund");

    const created = await requestToolAction(ticket, "create_replacement_order", {
      order_id: "ord_5003",
      sku: "BG-CAM-02",
      reason: "damaged",
      idempotency_key: `${staleTicketId}-replacement-1`,
    });
    if (created.kind !== "created") throw new Error("fixture setup failed");
    await decideToolAction(created.action.action_id, reviewerId, "approved without checking", "approved");

    const outcome = await executeToolAction(created.action.action_id);
    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") {
      expect(outcome.action.status).toBe("failed");
      expect(outcome.action.execution_result).toHaveProperty("error");
    }
  });

  it("does not eligibility-gate tools with no return/warranty window (e.g. carrier investigation)", async () => {
    const ticket = await triagedTicket("tkt_9002", "shipping");
    const created = await requestToolAction(ticket, "open_carrier_investigation", {
      order_id: "ord_5002",
      tracking_number: "BLUETRK10002",
      reason: "stale tracking",
      idempotency_key: "tkt_9002-execute-happy",
    });
    if (created.kind !== "created") throw new Error("fixture setup failed");
    // open_carrier_investigation auto-approves; no separate approve call needed.
    const outcome = await executeToolAction(created.action.action_id);
    expect(outcome.kind).toBe("executed");
  });
});
