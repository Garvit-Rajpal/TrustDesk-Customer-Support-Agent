// V4-15 (LLD_v4 §6, HLD_v4 ADR-22): semantic judge layer, unit-tested
// against MockModelAdapter the same way triage/draft prompt builders are.
import { describe, expect, it } from "vitest";
import { semanticJudgeScan, SEMANTIC_JUDGE_SYSTEM_PROMPT } from "../../../src/services/guardrails/semanticJudge.js";
import { MockModelAdapter } from "../../../src/adapters/mock.js";
import type { RawDraftOutput } from "../../../src/domain/schemas.js";
import type { Ticket } from "../../../src/domain/entities.js";

const ticket: Ticket = {
  ticket_id: "tkt_judge_test",
  customer_id: "cus_1001",
  order_id: "ord_5001",
  channel: "email",
  subject: "Test",
  body: "Test body",
  status: "in_progress",
  created_at: "2026-06-28T10:15:00+05:30",
  triage: null,
  human_owned: false,
  human_owned_by: null,
  human_owned_at: null,
};

function draft(overrides: Partial<RawDraftOutput> = {}): RawDraftOutput {
  return {
    body: "Thanks for reaching out — we've started a review and will follow up shortly.",
    citations: [],
    resolution_type: "answered",
    recommended_actions: [],
    ...overrides,
  };
}

describe("semanticJudgeScan", () => {
  it("rubric never names a specific KB doc ID or ticket ID (invariant #2 review gate)", () => {
    expect(SEMANTIC_JUDGE_SYSTEM_PROMPT).not.toMatch(/KB-[A-Z]/);
    expect(SEMANTIC_JUDGE_SYSTEM_PROMPT).not.toMatch(/tkt_/);
  });

  it("passes a clean verdict through", async () => {
    const adapter = new MockModelAdapter({
      "tkt_judge_test:judge": { content: JSON.stringify({ passed: true, reason: "in scope, appropriate tone" }) },
    });
    const result = await semanticJudgeScan(adapter, ticket, draft());
    expect(result).toMatchObject({ layer: "semantic_judge", check: "judge_verdict", passed: true });
    expect(result.detail).toBeUndefined();
  });

  it("fails closed on a failing verdict, carrying the judge's reason as detail", async () => {
    const adapter = new MockModelAdapter({
      "tkt_judge_test:judge": {
        content: JSON.stringify({ passed: false, reason: "promises a specific refund amount with no backing action" }),
      },
    });
    const result = await semanticJudgeScan(adapter, ticket, draft());
    expect(result.passed).toBe(false);
    expect(result.detail).toBe("promises a specific refund amount with no backing action");
  });

  it("retries once on invalid JSON, then succeeds if the retry is valid", async () => {
    const adapter = new MockModelAdapter({
      "tkt_judge_test:judge": [
        { content: "not json" },
        { content: JSON.stringify({ passed: true, reason: "fine" }) },
      ],
    });
    const result = await semanticJudgeScan(adapter, ticket, draft());
    expect(result.passed).toBe(true);
    expect(adapter.callCount("tkt_judge_test:judge")).toBe(2);
  });

  it("fails closed when the model output is invalid JSON on both attempts", async () => {
    const adapter = new MockModelAdapter({
      "tkt_judge_test:judge": { content: "not json at all" },
    });
    const result = await semanticJudgeScan(adapter, ticket, draft());
    expect(result.passed).toBe(false);
    expect(result.detail).toBe("judge model output invalid after retry");
    expect(adapter.callCount("tkt_judge_test:judge")).toBe(2);
  });

  it("fails closed when the parsed JSON doesn't match the verdict schema", async () => {
    const adapter = new MockModelAdapter({
      "tkt_judge_test:judge": { content: JSON.stringify({ ok: true }) },
    });
    const result = await semanticJudgeScan(adapter, ticket, draft());
    expect(result.passed).toBe(false);
  });
});
