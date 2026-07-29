// V2-3 (LLD_v2 §4/§9): "metric math on fixture data" — same pattern as
// evalScorer.test.ts (LLD §9 milestone 8): a pure function over hand-built
// fixture arrays, expected values hand-computed, no DB involved.
import { describe, expect, it } from "vitest";
import { computeQualityMetrics } from "../../src/services/qualityMetrics.js";

describe("computeQualityMetrics", () => {
  it("computes overall rates from hand-computed fixture data", () => {
    const result = computeQualityMetrics({
      feedback: [
        { category: "refund", rating: 5 },
        { category: "refund", rating: 2 },
        { category: "shipping", rating: 4 },
        { category: "shipping", rating: 4 },
      ],
      approvals: [
        { category: "refund", decision: "approved" },
        { category: "refund", decision: "rejected" },
        { category: "shipping", decision: "approved" },
      ],
      agentRuns: [
        { category: "refund", status: "completed" },
        { category: "refund", status: "completed" },
        { category: "refund", status: "guardrail_blocked" },
        { category: "shipping", status: "completed" },
      ],
    });

    // avg_rating = (5+2+4+4)/4 = 3.75
    expect(result.avg_rating).toBeCloseTo(3.75);
    // draft_acceptance_rate = ratings >= 4 (5,4,4 = 3) / 4 total = 0.75
    expect(result.draft_acceptance_rate).toBeCloseTo(0.75);
    // action_approval_rate = 2 approved / 3 total = 0.6666...
    expect(result.action_approval_rate).toBeCloseTo(2 / 3);
    // guardrail_block_rate = 1 blocked / 4 runs = 0.25
    expect(result.guardrail_block_rate).toBeCloseTo(0.25);
  });

  it("breaks metrics down by category independently", () => {
    const result = computeQualityMetrics({
      feedback: [
        { category: "refund", rating: 5 },
        { category: "refund", rating: 1 },
        { category: "billing", rating: 3 },
      ],
      approvals: [
        { category: "refund", decision: "approved" },
        { category: "billing", decision: "rejected" },
      ],
      agentRuns: [
        { category: "refund", status: "guardrail_blocked" },
        { category: "billing", status: "completed" },
      ],
    });

    expect(result.by_category.refund).toEqual({
      draft_acceptance_rate: 0.5, // 1 of 2 ratings >= 4
      action_approval_rate: 1, // 1/1 approved
      avg_rating: 3, // (5+1)/2
      guardrail_block_rate: 1, // 1/1 blocked
    });
    expect(result.by_category.billing).toEqual({
      draft_acceptance_rate: 0, // 0 of 1 rating >= 4
      action_approval_rate: 0, // 0/1 approved
      avg_rating: 3,
      guardrail_block_rate: 0, // 0/1 blocked
    });
  });

  it("returns null (not 0, not NaN) for a rate with an empty denominator", () => {
    const result = computeQualityMetrics({ feedback: [], approvals: [], agentRuns: [] });
    expect(result).toEqual({
      draft_acceptance_rate: null,
      action_approval_rate: null,
      avg_rating: null,
      guardrail_block_rate: null,
      by_category: {},
    });
  });

  it("treats a rating of exactly 4 as accepted (>= 4, not > 4)", () => {
    const result = computeQualityMetrics({
      feedback: [{ category: "general", rating: 4 }],
      approvals: [],
      agentRuns: [],
    });
    expect(result.draft_acceptance_rate).toBe(1);
  });

  it("only counts categories that actually appear in at least one input array", () => {
    const result = computeQualityMetrics({
      feedback: [{ category: "warranty", rating: 5 }],
      approvals: [],
      agentRuns: [],
    });
    expect(Object.keys(result.by_category)).toEqual(["warranty"]);
    expect(result.by_category.warranty!.action_approval_rate).toBeNull();
    expect(result.by_category.warranty!.guardrail_block_rate).toBeNull();
  });
});
