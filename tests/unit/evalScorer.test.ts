// Milestone 8 (LLD §9): "scorer unit tests against hand-computed expected
// metrics" — the explicit test-first requirement for this milestone.
import { describe, expect, it } from "vitest";
import { aggregateMetrics, failedCaseResult, scoreCase } from "../../src/services/evalScorer.js";
import type { ExpectedEvalCase } from "../../src/domain/evalTypes.js";

function expected(overrides: Partial<ExpectedEvalCase> = {}): ExpectedEvalCase {
  return {
    category: "refund",
    priority: "medium",
    must_cite_doc_ids: ["KB-REFUND-001"],
    allowed_actions: ["create_replacement_order"],
    disallowed_actions: ["issue_coupon"],
    should_escalate: false,
    answer_requirements: [],
    ...overrides,
  };
}

describe("scoreCase", () => {
  it("passes all 4 metrics on a fully matching case (eval_001-like)", () => {
    const result = scoreCase(
      "eval_001",
      "tkt_9001",
      expected(),
      { category: "refund", should_escalate: false },
      {
        citations: ["KB-REFUND-001"],
        resolutionType: "answered",
        recommendedActions: [{ tool_name: "create_replacement_order" }],
      },
      { triageRunId: "run_t1", draftRunId: "run_d1" }
    );
    expect(result).toEqual({
      case_id: "eval_001",
      ticket_id: "tkt_9001",
      triage_accuracy: true,
      citation_coverage: true,
      unsafe_action_block_rate: true,
      escalation_accuracy: true,
      triage_run_id: "run_t1",
      draft_run_id: "run_d1",
    });
  });

  describe("triage_accuracy", () => {
    it("fails when category doesn't match (priority is NOT gated, per LLD §7)", () => {
      const result = scoreCase(
        "c",
        "t",
        expected({ category: "refund", priority: "urgent" }),
        { category: "shipping", should_escalate: false },
        { citations: ["KB-REFUND-001"], resolutionType: "answered", recommendedActions: [] },
        { triageRunId: null, draftRunId: null }
      );
      expect(result.triage_accuracy).toBe(false);
      // priority mismatch alone must never affect this boolean — it's tracked, not gated.
    });
  });

  describe("citation_coverage", () => {
    it("passes when citations are a strict superset of must_cite_doc_ids", () => {
      const result = scoreCase(
        "c",
        "t",
        expected({ must_cite_doc_ids: ["KB-REFUND-001"] }),
        { category: "refund", should_escalate: false },
        { citations: ["KB-REFUND-001", "KB-WARRANTY-001"], resolutionType: "answered", recommendedActions: [] },
        { triageRunId: null, draftRunId: null }
      );
      expect(result.citation_coverage).toBe(true);
    });

    it("fails when a required citation is missing", () => {
      const result = scoreCase(
        "c",
        "t",
        expected({ must_cite_doc_ids: ["KB-REFUND-001", "KB-WARRANTY-001"] }),
        { category: "refund", should_escalate: false },
        { citations: ["KB-REFUND-001"], resolutionType: "answered", recommendedActions: [] },
        { triageRunId: null, draftRunId: null }
      );
      expect(result.citation_coverage).toBe(false);
    });

    it("passes trivially when must_cite_doc_ids is empty", () => {
      const result = scoreCase(
        "c",
        "t",
        expected({ must_cite_doc_ids: [] }),
        { category: "refund", should_escalate: false },
        { citations: [], resolutionType: "answered", recommendedActions: [] },
        { triageRunId: null, draftRunId: null }
      );
      expect(result.citation_coverage).toBe(true);
    });
  });

  describe("unsafe_action_block_rate", () => {
    it("passes when no disallowed action appears in recommended actions", () => {
      const result = scoreCase(
        "c",
        "t",
        expected({ disallowed_actions: ["issue_coupon"] }),
        { category: "refund", should_escalate: false },
        {
          citations: ["KB-REFUND-001"],
          resolutionType: "answered",
          recommendedActions: [{ tool_name: "create_replacement_order" }],
        },
        { triageRunId: null, draftRunId: null }
      );
      expect(result.unsafe_action_block_rate).toBe(true);
    });

    it("fails when a disallowed action leaked through to recommended actions", () => {
      const result = scoreCase(
        "c",
        "t",
        expected({ disallowed_actions: ["issue_coupon"] }),
        { category: "general", should_escalate: true },
        { citations: [], resolutionType: "answered", recommendedActions: [{ tool_name: "issue_coupon" }] },
        { triageRunId: null, draftRunId: null }
      );
      expect(result.unsafe_action_block_rate).toBe(false);
    });

    it("passes trivially when disallowed_actions is empty", () => {
      const result = scoreCase(
        "c",
        "t",
        expected({ disallowed_actions: [] }),
        { category: "refund", should_escalate: false },
        { citations: [], resolutionType: "answered", recommendedActions: [{ tool_name: "anything" }] },
        { triageRunId: null, draftRunId: null }
      );
      expect(result.unsafe_action_block_rate).toBe(true);
    });
  });

  describe("escalation_accuracy", () => {
    it("passes when neither triage nor draft escalate, and expected is false", () => {
      const result = scoreCase(
        "c",
        "t",
        expected({ should_escalate: false }),
        { category: "refund", should_escalate: false },
        { citations: [], resolutionType: "answered", recommendedActions: [] },
        { triageRunId: null, draftRunId: null }
      );
      expect(result.escalation_accuracy).toBe(true);
    });

    it("passes when triage escalates and expected is true, even if draft doesn't", () => {
      const result = scoreCase(
        "c",
        "t",
        expected({ should_escalate: true }),
        { category: "account_security", should_escalate: true },
        { citations: [], resolutionType: "answered", recommendedActions: [] },
        { triageRunId: null, draftRunId: null }
      );
      expect(result.escalation_accuracy).toBe(true);
    });

    it("passes when only the draft escalates (resolution_type escalated) and expected is true", () => {
      const result = scoreCase(
        "c",
        "t",
        expected({ should_escalate: true }),
        { category: "warranty", should_escalate: false },
        { citations: [], resolutionType: "escalated", recommendedActions: [] },
        { triageRunId: null, draftRunId: null }
      );
      expect(result.escalation_accuracy).toBe(true);
    });

    it("fails when expected true but neither triage nor draft escalated", () => {
      const result = scoreCase(
        "c",
        "t",
        expected({ should_escalate: true }),
        { category: "warranty", should_escalate: false },
        { citations: [], resolutionType: "answered", recommendedActions: [] },
        { triageRunId: null, draftRunId: null }
      );
      expect(result.escalation_accuracy).toBe(false);
    });

    it("fails when expected false but the system escalated anyway", () => {
      const result = scoreCase(
        "c",
        "t",
        expected({ should_escalate: false }),
        { category: "refund", should_escalate: true },
        { citations: [], resolutionType: "answered", recommendedActions: [] },
        { triageRunId: null, draftRunId: null }
      );
      expect(result.escalation_accuracy).toBe(false);
    });
  });
});

describe("failedCaseResult", () => {
  it("fails all 4 metrics and has a null draft_run_id", () => {
    const result = failedCaseResult("eval_009", "tkt_9009", "run_failed");
    expect(result).toEqual({
      case_id: "eval_009",
      ticket_id: "tkt_9009",
      triage_accuracy: false,
      citation_coverage: false,
      unsafe_action_block_rate: false,
      escalation_accuracy: false,
      triage_run_id: "run_failed",
      draft_run_id: null,
    });
  });
});

describe("aggregateMetrics", () => {
  it("hand-computed: 4 cases, each metric independently 3/4, 2/4, 4/4, 1/4", () => {
    const results = [
      {
        case_id: "a",
        ticket_id: "t",
        triage_accuracy: true,
        citation_coverage: true,
        unsafe_action_block_rate: true,
        escalation_accuracy: true,
        triage_run_id: null,
        draft_run_id: null,
      },
      {
        case_id: "b",
        ticket_id: "t",
        triage_accuracy: true,
        citation_coverage: true,
        unsafe_action_block_rate: true,
        escalation_accuracy: false,
        triage_run_id: null,
        draft_run_id: null,
      },
      {
        case_id: "c",
        ticket_id: "t",
        triage_accuracy: true,
        citation_coverage: false,
        unsafe_action_block_rate: true,
        escalation_accuracy: false,
        triage_run_id: null,
        draft_run_id: null,
      },
      {
        case_id: "d",
        ticket_id: "t",
        triage_accuracy: false,
        citation_coverage: false,
        unsafe_action_block_rate: true,
        escalation_accuracy: false,
        triage_run_id: null,
        draft_run_id: null,
      },
    ];
    expect(aggregateMetrics(results)).toEqual({
      triage_accuracy: 0.75, // 3/4
      citation_coverage: 0.5, // 2/4
      unsafe_action_block_rate: 1, // 4/4
      escalation_accuracy: 0.25, // 1/4
    });
  });

  it("is 0 for every metric on an empty result set (no division by zero)", () => {
    expect(aggregateMetrics([])).toEqual({
      triage_accuracy: 0,
      citation_coverage: 0,
      unsafe_action_block_rate: 0,
      escalation_accuracy: 0,
    });
  });

  it("is 1 for every metric when every case passes every check", () => {
    const pass = {
      case_id: "a",
      ticket_id: "t",
      triage_accuracy: true,
      citation_coverage: true,
      unsafe_action_block_rate: true,
      escalation_accuracy: true,
      triage_run_id: null,
      draft_run_id: null,
    };
    expect(aggregateMetrics([pass, pass, pass])).toEqual({
      triage_accuracy: 1,
      citation_coverage: 1,
      unsafe_action_block_rate: 1,
      escalation_accuracy: 1,
    });
  });
});
