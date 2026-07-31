// V4-16 (LLD_v4 §6, HLD_v4 ADR-22): orgPolicyScan() wired into
// generateDraft(), alongside outputScan() — draft.ts looks up the ticket's
// actual org vertical from the DB (org_default is retail_ecommerce, see
// seed.ts), not a hardcoded value, and a failure feeds the same fail-closed
// substitution outputScan() failures already use.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";
import { generateDraft } from "../../src/services/draft.js";
import { MockModelAdapter } from "../../src/adapters/mock.js";
import { getTicketById, updateTicketTriage } from "../../src/db/repos/ticketsRepo.js";
import { getCustomerById } from "../../src/db/repos/customersRepo.js";
import { getOrderById } from "../../src/db/repos/ordersRepo.js";
import { getAgentRunById } from "../../src/db/repos/agentRunsRepo.js";
import { ESCALATION_TEMPLATE_BODY } from "../../src/services/guardrails/templates/escalation.js";
import type { TriageResult } from "../../src/domain/schemas.js";
import { ORG_DEFAULT } from "../helpers/org.js";

async function triageAndLoad(ticketId: string, triage: TriageResult) {
  await updateTicketTriage(ORG_DEFAULT, ticketId, triage);
  const ticket = await getTicketById(ORG_DEFAULT, ticketId);
  if (!ticket) throw new Error(`fixture ticket ${ticketId} missing`);
  const customer = await getCustomerById(ORG_DEFAULT, ticket.customer_id);
  const order = ticket.order_id ? await getOrderById(ORG_DEFAULT, ticket.order_id) : null;
  return { ticket, customer: customer!, order };
}

const CLEAN_TRIAGE: TriageResult = {
  category: "refund",
  priority: "medium",
  sentiment: "frustrated",
  should_escalate: false,
  reason_summary: "Damaged item within return window.",
};

function draftResponse(body: string, citations: string[] = ["KB-REFUND-001"]) {
  return JSON.stringify({ body, citations, resolution_type: "answered", recommended_actions: [] });
}

describe("org policy-pack wiring into generateDraft() (V4-16)", () => {
  beforeAll(async () => {
    await truncateAll();
    await runSeed();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("org_default (retail_ecommerce) fails closed on a retail_ecommerce policy violation", async () => {
    const { ticket, customer, order } = await triageAndLoad("tkt_9001", CLEAN_TRIAGE);
    const adapter = new MockModelAdapter({
      "tkt_9001:draft": {
        content: draftResponse("I guarantee it will arrive by Friday no matter what happens."),
      },
    });

    const outcome = await generateDraft(ORG_DEFAULT, adapter, ticket, customer, order);
    expect(outcome.resolutionType).toBe("escalated");
    expect(outcome.body).toBe(ESCALATION_TEMPLATE_BODY);

    const run = await getAgentRunById(ORG_DEFAULT, outcome.runId);
    expect(run!.status).toBe("guardrail_blocked");
    const guardrailResults = run!.guardrail_results as Array<{ layer: string; check: string; passed: boolean }>;
    const orgPolicyResult = guardrailResults.find((r) => r.check === "no_unbacked_delivery_guarantee");
    expect(orgPolicyResult).toMatchObject({
      layer: "org_policy",
      check: "no_unbacked_delivery_guarantee",
      passed: false,
    });
  });

  it("org_default is unaffected by a different vertical's rule phrase (cross-vertical isolation reaches the real pipeline)", async () => {
    const { ticket, customer, order } = await triageAndLoad("tkt_9002", CLEAN_TRIAGE);
    // "internal repository" is a software-vertical trigger phrase — must not
    // be flagged for a retail_ecommerce org.
    const adapter = new MockModelAdapter({
      "tkt_9002:draft": {
        content: draftResponse("You can find more details in our internal repository article."),
      },
    });

    const outcome = await generateDraft(ORG_DEFAULT, adapter, ticket, customer, order);
    expect(outcome.resolutionType).toBe("answered");

    const run = await getAgentRunById(ORG_DEFAULT, outcome.runId);
    const guardrailResults = run!.guardrail_results as Array<{ layer: string; check: string }>;
    expect(guardrailResults.some((r) => r.check === "no_source_code_disclosure")).toBe(false);
  });

  it("a clean draft passes every retail_ecommerce org_policy rule", async () => {
    const { ticket, customer, order } = await triageAndLoad("tkt_9003", CLEAN_TRIAGE);
    const adapter = new MockModelAdapter({
      "tkt_9003:draft": { content: draftResponse("Thanks for reaching out — we've started a review.") },
    });

    const outcome = await generateDraft(ORG_DEFAULT, adapter, ticket, customer, order);
    expect(outcome.resolutionType).toBe("answered");

    const run = await getAgentRunById(ORG_DEFAULT, outcome.runId);
    const guardrailResults = run!.guardrail_results as Array<{ layer: string; passed: boolean }>;
    expect(guardrailResults.filter((r) => r.layer === "org_policy").every((r) => r.passed)).toBe(true);
  });
});
