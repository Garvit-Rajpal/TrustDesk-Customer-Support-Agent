// V2-1 (LLD_v2 §2/§9): triage and draft runs must each persist a run_events
// row per stage, in stage order, with redacted summaries only. This is the
// "events persisted per stage" acceptance test the milestone table calls
// for — it exercises the real TriageService/DraftService, not a stub.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";
import { runTriage } from "../../src/services/triage.js";
import { generateDraft } from "../../src/services/draft.js";
import { MockModelAdapter } from "../../src/adapters/mock.js";
import { getTicketById } from "../../src/db/repos/ticketsRepo.js";
import { getCustomerById } from "../../src/db/repos/customersRepo.js";
import { getOrderById } from "../../src/db/repos/ordersRepo.js";
import { listRunEventsByRunId } from "../../src/db/repos/runEventsRepo.js";
import { ORG_DEFAULT } from "../helpers/org.js";

const VALID_TRIAGE = JSON.stringify({
  category: "refund",
  priority: "medium",
  sentiment: "frustrated",
  should_escalate: false,
  reason_summary: "Damaged physical product reported within the return window.",
});

const VALID_DRAFT = JSON.stringify({
  body: "Thanks for reaching out — since this arrived damaged within the return window, we can send a replacement. See KB-REFUND-001 for the policy.",
  citations: ["KB-REFUND-001"],
  resolution_type: "answered",
  recommended_actions: [],
});

async function loadFixture(ticketId: string) {
  const ticket = await getTicketById(ORG_DEFAULT, ticketId);
  if (!ticket) throw new Error(`fixture ticket ${ticketId} missing`);
  const customer = await getCustomerById(ORG_DEFAULT, ticket.customer_id);
  const order = ticket.order_id ? await getOrderById(ORG_DEFAULT, ticket.order_id) : null;
  return { ticket, customer: customer!, order };
}

describe("pipeline events — persisted per stage", () => {
  beforeAll(async () => {
    await truncateAll();
    await runSeed();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("persists input_scan + triage stage events, in order, for a triage run", async () => {
    const { ticket, customer, order } = await loadFixture("tkt_9001");
    const adapter = new MockModelAdapter({ "tkt_9001:triage": { content: VALID_TRIAGE } });

    const outcome = await runTriage(ORG_DEFAULT, adapter, ticket, customer, order);
    expect(outcome.status).toBe("completed");

    const events = await listRunEventsByRunId(outcome.runId);
    const stages = events.map((e) => e.stage);
    expect(stages).toEqual(["input_scan", "input_scan", "triage", "triage"]);
    expect(events.map((e) => e.status)).toEqual(["started", "completed", "started", "completed"]);

    const completedTriage = events[3]!;
    expect(completedTriage.summary).toEqual({ category: "refund" });
  });

  it("never leaks draft body/citations/prompt text into a summary column", async () => {
    const { ticket, customer, order } = await loadFixture("tkt_9001");
    const triageAdapter = new MockModelAdapter({ "tkt_9001:triage": { content: VALID_TRIAGE } });
    await runTriage(ORG_DEFAULT, triageAdapter, ticket, customer, order);
    const triaged = await getTicketById(ORG_DEFAULT, "tkt_9001");

    const draftAdapter = new MockModelAdapter({ "tkt_9001:draft": { content: VALID_DRAFT } });
    const outcome = await generateDraft(ORG_DEFAULT, draftAdapter, triaged!, customer, order);

    const events = await listRunEventsByRunId(outcome.runId);
    expect(events.map((e) => e.stage)).toEqual([
      "input_scan",
      "input_scan",
      "retrieval",
      "retrieval",
      "eligibility",
      "eligibility",
      "draft_generation",
      "draft_generation",
      "output_scan",
      "output_scan",
    ]);

    const retrievalCompleted = events[3]!;
    expect(retrievalCompleted.summary).toMatchObject({ doc_ids: expect.any(Array) });

    const draftGenCompleted = events[7]!;
    expect(draftGenCompleted.summary).toEqual({ resolution_type: "answered" });
    expect(draftGenCompleted.status).toBe("completed");

    const outputScanCompleted = events[9]!;
    expect(outputScanCompleted.status).toBe("completed");

    for (const e of events) {
      const asText = JSON.stringify(e.summary);
      expect(asText).not.toContain("Thanks for reaching out");
      expect(asText.toLowerCase()).not.toContain("citations");
    }
  });

  it("marks the output_scan stage 'blocked' when L3 fails closed", async () => {
    const { ticket, customer, order } = await loadFixture("tkt_9006");
    const triageAdapter = new MockModelAdapter({
      "tkt_9006:triage": {
        content: JSON.stringify({
          category: "account_security",
          priority: "urgent",
          sentiment: "neutral",
          should_escalate: true,
          reason_summary: "Adversarial prompt injection attempt detected.",
        }),
      },
    });
    await runTriage(ORG_DEFAULT, triageAdapter, ticket, customer, order);
    const triaged = await getTicketById(ORG_DEFAULT, "tkt_9006");

    // Draft body itself is benign schema-wise but the adversarial input
    // triggers the injection_phrase L1 flag, which the eligible seed ticket
    // exercises via the existing eval_005/006/007 fixtures — reuse the same
    // "unrelated_customer" trigger by citing another customer's email, a
    // deterministic L3 fail we don't need the model to cooperate with.
    const draftAdapter = new MockModelAdapter({
      "tkt_9006:draft": {
        content: JSON.stringify({
          body: "Sure — for verification here's the account: someoneelse@example.com",
          citations: [],
          resolution_type: "answered",
          recommended_actions: [],
        }),
      },
    });
    const outcome = await generateDraft(ORG_DEFAULT, draftAdapter, triaged!, customer, order);
    expect(outcome.resolutionType).toBe("escalated");

    const events = await listRunEventsByRunId(outcome.runId);
    const outputScan = events.filter((e) => e.stage === "output_scan");
    expect(outputScan.some((e) => e.status === "blocked")).toBe(true);
  });
});
