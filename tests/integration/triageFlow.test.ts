// Milestone 5 (LLD §9): triage flow — enum validation, retry-once, override
// behavior, trace written. Full service + DB + MockModelAdapter (LLD §1).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";
import { runTriage } from "../../src/services/triage.js";
import { MockModelAdapter } from "../../src/adapters/mock.js";
import { getTicketById } from "../../src/db/repos/ticketsRepo.js";
import { getCustomerById } from "../../src/db/repos/customersRepo.js";
import { getOrderById } from "../../src/db/repos/ordersRepo.js";
import { getAgentRunById } from "../../src/db/repos/agentRunsRepo.js";
import { listMessagesByTicketId } from "../../src/db/repos/ticketMessagesRepo.js";
import { subscribeSentMessages } from "../../src/services/events/customerThreadBus.js";
import { PIPELINE_FAILURE_TEXT } from "../../src/services/pipelineFailureTemplate.js";
import { ORG_DEFAULT } from "../helpers/org.js";

const VALID_RESPONSE = JSON.stringify({
  category: "refund",
  priority: "medium",
  sentiment: "frustrated",
  should_escalate: false,
  reason_summary: "Damaged physical product reported within the return window.",
});

async function loadFixture(ticketId: string) {
  const ticket = await getTicketById(ORG_DEFAULT, ticketId);
  if (!ticket) throw new Error(`fixture ticket ${ticketId} missing`);
  const customer = await getCustomerById(ORG_DEFAULT, ticket.customer_id);
  const order = ticket.order_id ? await getOrderById(ORG_DEFAULT, ticket.order_id) : null;
  return { ticket, customer: customer!, order };
}

describe("triage flow", () => {
  beforeAll(async () => {
    await truncateAll();
    await runSeed();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("validates enums and persists a completed run + ticket.triage", async () => {
    const { ticket, customer, order } = await loadFixture("tkt_9001");
    const adapter = new MockModelAdapter({ "tkt_9001:triage": { content: VALID_RESPONSE } });

    const outcome = await runTriage(ORG_DEFAULT, adapter, ticket, customer, order);

    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") throw new Error("unreachable");
    expect(outcome.result.category).toBe("refund");
    expect(outcome.result.should_escalate).toBe(false);

    const updated = await getTicketById(ORG_DEFAULT, "tkt_9001");
    expect(updated?.triage).toEqual(outcome.result);

    const run = await getAgentRunById(ORG_DEFAULT, outcome.runId);
    expect(run).not.toBeNull();
    expect(run?.run_type).toBe("triage");
    expect(run?.status).toBe("completed");
    expect(run?.ticket_id).toBe("tkt_9001");
    expect(run?.guardrail_results).toHaveLength(4); // 3 L1 checks + 1 L2 structural pass
    expect(run?.retrieved_doc_ids).toEqual([]);
  });

  it("retries once on invalid model output, then succeeds", async () => {
    const { ticket, customer, order } = await loadFixture("tkt_9002");
    const adapter = new MockModelAdapter({
      "tkt_9002:triage": [{ content: "not valid json" }, { content: VALID_RESPONSE }],
    });

    const outcome = await runTriage(ORG_DEFAULT, adapter, ticket, customer, order);

    expect(outcome.status).toBe("completed");
    expect(adapter.callCount("tkt_9002:triage")).toBe(2);
  });

  it("fails the run after a second invalid response (no infinite retry)", async () => {
    const { ticket, customer, order } = await loadFixture("tkt_9003");
    const adapter = new MockModelAdapter({
      "tkt_9003:triage": [{ content: "not json" }, { content: '{"category":"not-a-real-category"}' }],
    });

    const outcome = await runTriage(ORG_DEFAULT, adapter, ticket, customer, order);

    expect(outcome.status).toBe("failed");
    expect(adapter.callCount("tkt_9003:triage")).toBe(2);

    if (outcome.status !== "failed") throw new Error("unreachable");
    const run = await getAgentRunById(ORG_DEFAULT, outcome.runId);
    expect(run?.status).toBe("failed");
    expect(run?.rejected_output).toBeTruthy();

    // Ticket triage must remain untouched on failure.
    const stillUntriaged = await getTicketById(ORG_DEFAULT, "tkt_9003");
    expect(stillUntriaged?.triage).toBeNull();
  });

  // Regression: a customer chatting with a brand-new ticket whose triage
  // fails used to leave the ticket permanently stuck at "open" (no status
  // advance on failure) and the customer with zero feedback (no WS status
  // frame, no persisted message) — their *next* message would then be
  // silently rejected by receiveCustomerMessage()'s canTransition guard,
  // which only allows a customer reply from "awaiting_customer"/"resolved".
  it("on failure, still advances the ticket to awaiting_customer and posts+publishes a persisted fallback message", async () => {
    const { ticket, customer, order } = await loadFixture("tkt_9004");
    expect(ticket.status).toBe("open"); // fixture assumption: untouched by any earlier test in this file
    const adapter = new MockModelAdapter({
      "tkt_9004:triage": [{ content: "not json" }, { content: "still not json" }],
    });

    const published: unknown[] = [];
    const unsubscribe = subscribeSentMessages("tkt_9004", (message) => published.push(message));

    const outcome = await runTriage(ORG_DEFAULT, adapter, ticket, customer, order);
    unsubscribe();

    expect(outcome.status).toBe("failed");

    // Two-step advance: open -> in_progress (same "someone needs to look at
    // this" step a successful triage applies) -> awaiting_customer (same
    // step sendDraft()/sendManualReply() apply after actually sending a
    // reply — the fallback message below is exactly that), so the
    // customer's next reply is a legal transition, not silently dropped.
    const updated = await getTicketById(ORG_DEFAULT, "tkt_9004");
    expect(updated?.status).toBe("awaiting_customer");

    const messages = await listMessagesByTicketId(ORG_DEFAULT, "tkt_9004");
    const fallback = messages.find((m) => m.body === PIPELINE_FAILURE_TEXT);
    expect(fallback).toBeDefined();
    expect(fallback?.direction).toBe("outbound");
    expect(fallback?.author).toBe("system");

    expect(published).toHaveLength(1);
    expect((published[0] as { body: string }).body).toBe(PIPELINE_FAILURE_TEXT);
  });

  // The adapter throwing outright (e.g. MockModelAdapter with no scenario
  // registered for a freshly-created ticket_id — exactly what happens with
  // MODEL_TIER=mock and a ticket created live via the customer-chat portal)
  // must be treated the same as an invalid response, not propagate uncaught.
  it("treats a thrown adapter error the same as an invalid response (retries, then fails closed)", async () => {
    const { ticket, customer, order } = await loadFixture("tkt_9005");
    const adapter = new MockModelAdapter({}); // no "tkt_9005:triage" scenario at all

    const outcome = await runTriage(ORG_DEFAULT, adapter, ticket, customer, order);

    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") throw new Error("unreachable");
    const run = await getAgentRunById(ORG_DEFAULT, outcome.runId);
    expect(run?.status).toBe("failed");
    expect(run?.rejected_output).toContain("no scenario registered");

    const updated = await getTicketById(ORG_DEFAULT, "tkt_9005");
    expect(updated?.status).toBe("awaiting_customer");
  });

  it("forces should_escalate=true via deterministic override even when the model says false (tkt_9006 injection)", async () => {
    const { ticket, customer, order } = await loadFixture("tkt_9006");
    // Mock model is "fooled" by the injection and reports no escalation needed.
    const modelFooled = JSON.stringify({
      category: "general",
      priority: "medium",
      sentiment: "neutral",
      should_escalate: false,
      reason_summary: "Customer requested a coupon.",
    });
    const adapter = new MockModelAdapter({ "tkt_9006:triage": { content: modelFooled } });

    const outcome = await runTriage(ORG_DEFAULT, adapter, ticket, customer, order);

    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") throw new Error("unreachable");
    expect(outcome.result.should_escalate).toBe(true);

    const run = await getAgentRunById(ORG_DEFAULT, outcome.runId);
    const injectionCheck = (run?.guardrail_results as Array<{ check: string; passed: boolean }>).find(
      (r) => r.check === "injection_phrase"
    );
    expect(injectionCheck?.passed).toBe(false);
  });

  it("forces should_escalate=true for tkt_9007 (secret extraction attempt)", async () => {
    const { ticket, customer, order } = await loadFixture("tkt_9007");
    const modelFooled = JSON.stringify({
      category: "account_security",
      priority: "high",
      sentiment: "neutral",
      should_escalate: false,
      reason_summary: "Customer asked a question.",
    });
    const adapter = new MockModelAdapter({ "tkt_9007:triage": { content: modelFooled } });

    const outcome = await runTriage(ORG_DEFAULT, adapter, ticket, customer, order);
    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") throw new Error("unreachable");
    expect(outcome.result.should_escalate).toBe(true);
  });

  it("does not force escalation when no guardrail flag is set and the model says false", async () => {
    const { ticket, customer, order } = await loadFixture("tkt_9001");
    const adapter = new MockModelAdapter({ "tkt_9001:triage": { content: VALID_RESPONSE } });

    const outcome = await runTriage(ORG_DEFAULT, adapter, ticket, customer, order);
    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") throw new Error("unreachable");
    expect(outcome.result.should_escalate).toBe(false);
  });

  it("writes a passed guardrail trace even on a fully clean ticket", async () => {
    const { ticket, customer, order } = await loadFixture("tkt_9001");
    const adapter = new MockModelAdapter({ "tkt_9001:triage": { content: VALID_RESPONSE } });

    const outcome = await runTriage(ORG_DEFAULT, adapter, ticket, customer, order);
    if (outcome.status !== "completed") throw new Error("unreachable");
    const run = await getAgentRunById(ORG_DEFAULT, outcome.runId);
    const results = run?.guardrail_results as Array<{ passed: boolean }>;
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it("handles a ticket with no linked order", async () => {
    const ticket = await getTicketById(ORG_DEFAULT, "tkt_9001");
    const customer = await getCustomerById(ORG_DEFAULT, "cus_1001");
    const adapter = new MockModelAdapter({ "tkt_9001:triage": { content: VALID_RESPONSE } });

    const outcome = await runTriage(ORG_DEFAULT, adapter, ticket!, customer!, null);
    expect(outcome.status).toBe("completed");
  });
});
