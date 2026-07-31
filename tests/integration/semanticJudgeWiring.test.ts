// V4-15 (LLD_v4 §6, HLD_v4 ADR-22): semanticJudgeScan() wired into
// generateDraft(). judgeModelAdapter is optional, deliberately mirroring
// V4-12's embeddingAdapter pattern — a caller that doesn't pass one (e.g.
// the eval runner, or draftFlow.test.ts's existing direct-call tests) skips
// the judge entirely, so pre-v4 behavior is unaffected unless a caller
// explicitly opts in. buildTicketsRouter always opts in for the real app.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";
import { generateDraft } from "../../src/services/draft.js";
import { app, buildApp } from "../../src/app.js";
import { MockModelAdapter } from "../../src/adapters/mock.js";
import { DEFAULT_MODEL_SCENARIOS } from "../../src/adapters/defaultMockScenarios.js";
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

function draftResponse(spec: { body: string; citations: string[]; resolution_type: "answered" }) {
  return JSON.stringify({ recommended_actions: [], ...spec });
}

const CLEAN_TRIAGE: TriageResult = {
  category: "refund",
  priority: "medium",
  sentiment: "frustrated",
  should_escalate: false,
  reason_summary: "Damaged item within return window.",
};

describe("semantic judge wiring into generateDraft() (V4-15)", () => {
  beforeAll(async () => {
    await truncateAll();
    await runSeed();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("skips the judge entirely when no judgeModelAdapter is supplied (pre-v4 behavior unaffected)", async () => {
    const { ticket, customer, order } = await triageAndLoad("tkt_9001", CLEAN_TRIAGE);
    const adapter = new MockModelAdapter({
      "tkt_9001:draft": draftResponseSpec(),
    });

    const outcome = await generateDraft(ORG_DEFAULT, adapter, ticket, customer, order);
    expect(outcome.resolutionType).toBe("answered");

    const run = await getAgentRunById(ORG_DEFAULT, outcome.runId);
    const guardrailResults = run!.guardrail_results as Array<{ layer: string }>;
    expect(guardrailResults.some((r) => r.layer === "semantic_judge")).toBe(false);
  });

  it("a passing judge verdict leaves the draft untouched and appends a passing semantic_judge result", async () => {
    const { ticket, customer, order } = await triageAndLoad("tkt_9002", CLEAN_TRIAGE);
    const modelAdapter = new MockModelAdapter({ "tkt_9002:draft": draftResponseSpec() });
    const judgeAdapter = new MockModelAdapter({
      "tkt_9002:judge": { content: JSON.stringify({ passed: true, reason: "in scope, appropriate tone" }) },
    });

    const outcome = await generateDraft(ORG_DEFAULT, modelAdapter, ticket, customer, order, undefined, judgeAdapter);
    expect(outcome.resolutionType).toBe("answered");
    expect(outcome.body).not.toBe(ESCALATION_TEMPLATE_BODY);

    const run = await getAgentRunById(ORG_DEFAULT, outcome.runId);
    const guardrailResults = run!.guardrail_results as Array<{ layer: string }>;
    const judgeResult = guardrailResults.find((r) => r.layer === "semantic_judge");
    expect(judgeResult).toMatchObject({ layer: "semantic_judge", check: "judge_verdict", passed: true });
  });

  it("a failing judge verdict discards the draft and substitutes the deterministic escalation template (fail-closed, same substitution path as L3)", async () => {
    const { ticket, customer, order } = await triageAndLoad("tkt_9003", CLEAN_TRIAGE);
    const modelAdapter = new MockModelAdapter({ "tkt_9003:draft": draftResponseSpec() });
    const judgeAdapter = new MockModelAdapter({
      "tkt_9003:judge": {
        content: JSON.stringify({ passed: false, reason: "promises a refund amount with no backing action" }),
      },
    });

    const outcome = await generateDraft(ORG_DEFAULT, modelAdapter, ticket, customer, order, undefined, judgeAdapter);
    expect(outcome.resolutionType).toBe("escalated");
    expect(outcome.body).toBe(ESCALATION_TEMPLATE_BODY);
    expect(outcome.citations).toEqual([]);

    const run = await getAgentRunById(ORG_DEFAULT, outcome.runId);
    expect(run!.status).toBe("guardrail_blocked");
    const guardrailResults = run!.guardrail_results as Array<{ layer: string }>;
    const judgeResult = guardrailResults.find((r) => r.layer === "semantic_judge");
    expect(judgeResult).toMatchObject({
      layer: "semantic_judge",
      check: "judge_verdict",
      passed: false,
      detail: "promises a refund amount with no backing action",
    });
  });

  // HTTP-level proof: buildTicketsRouter always wires the primary
  // modelAdapter as judgeModelAdapter, so a failing judge scenario reaches
  // the real POST /tickets/:id/draft-reply route the same way L3 failures
  // already do.
  it("a failing judge verdict surfaces as an escalated response through the real HTTP route", async () => {
    const token = (
      await request(app).post("/auth/login").send({ username: "agent1", password: "agent123" })
    ).body.data.token;

    const scenarios = {
      ...DEFAULT_MODEL_SCENARIOS,
      "tkt_9004:judge": {
        content: JSON.stringify({ passed: false, reason: "tone is alarming without a backing tool action" }),
      },
    };
    const testApp = buildApp(new MockModelAdapter(scenarios));

    await request(testApp).post("/tickets/tkt_9004/triage").set("Authorization", `Bearer ${token}`);
    const draft = await request(testApp)
      .post("/tickets/tkt_9004/draft-reply")
      .set("Authorization", `Bearer ${token}`);

    expect(draft.status).toBe(200);
    expect(draft.body.data.resolution_type).toBe("escalated");
    expect(draft.body.data.body).toBe(ESCALATION_TEMPLATE_BODY);
  });

  function draftResponseSpec() {
    return {
      content: draftResponse({
        body: "Sorry your item arrived damaged — since you're within the return window, we can offer a replacement.",
        citations: ["KB-REFUND-001"],
        resolution_type: "answered",
      }),
    };
  }
});
