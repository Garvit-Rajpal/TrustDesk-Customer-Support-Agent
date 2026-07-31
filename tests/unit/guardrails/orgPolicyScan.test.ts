// V4-16 (LLD_v4 §6, HLD_v4 ADR-22): per-org, per-vertical policy-pack rule
// layer. Rules load from src/policy_packs/{vertical}/guardrail_rules.json —
// this proves each vertical's file parses correctly AND that rules never
// cross-apply between verticals (an org's rules are looked up strictly by
// its own vertical, never a sibling's).
import { describe, expect, it } from "vitest";
import { orgPolicyScan } from "../../../src/services/guardrails/orgPolicyScan.js";
import type { RawDraftOutput } from "../../../src/domain/schemas.js";

function draft(body: string): RawDraftOutput {
  return { body, citations: [], resolution_type: "answered", recommended_actions: [] };
}

describe("orgPolicyScan", () => {
  it("passes a clean draft for every vertical", () => {
    for (const vertical of ["retail_ecommerce", "software", "finance"] as const) {
      const result = orgPolicyScan(draft("Thanks for reaching out, we've started a review."), vertical);
      expect(result.length).toBeGreaterThan(0);
      expect(result.every((r) => r.layer === "org_policy" && r.passed)).toBe(true);
    }
  });

  it("retail_ecommerce: fails on an unbacked delivery guarantee", () => {
    const result = orgPolicyScan(
      draft("I guarantee it will arrive by Friday no matter what."),
      "retail_ecommerce"
    );
    expect(result.find((r) => r.check === "no_unbacked_delivery_guarantee")?.passed).toBe(false);
  });

  it("software: fails on a source-code disclosure phrase", () => {
    const result = orgPolicyScan(
      draft("You can find the fix in our internal repository."),
      "software"
    );
    expect(result.find((r) => r.check === "no_source_code_disclosure")?.passed).toBe(false);
  });

  it("finance: fails on an investment-advice phrase", () => {
    const result = orgPolicyScan(draft("Honestly, you should invest in this."), "finance");
    expect(result.find((r) => r.check === "no_investment_advice")?.passed).toBe(false);
  });

  // Cross-vertical isolation: software's source-code phrase must not be
  // evaluated at all under retail_ecommerce or finance — those verticals
  // don't even have a "no_source_code_disclosure" check registered.
  it("cross-vertical isolation: a software-specific violation is not flagged under a different vertical", () => {
    const body = "You can find the fix in our internal repository.";
    const retailResult = orgPolicyScan(draft(body), "retail_ecommerce");
    const financeResult = orgPolicyScan(draft(body), "finance");
    expect(retailResult.some((r) => r.check === "no_source_code_disclosure")).toBe(false);
    expect(financeResult.some((r) => r.check === "no_source_code_disclosure")).toBe(false);
    expect(retailResult.every((r) => r.passed)).toBe(true);
    expect(financeResult.every((r) => r.passed)).toBe(true);
  });

  it("cross-vertical isolation: a finance-specific violation is not flagged under a different vertical", () => {
    const body = "Honestly, you should invest in this.";
    const retailResult = orgPolicyScan(draft(body), "retail_ecommerce");
    const softwareResult = orgPolicyScan(draft(body), "software");
    expect(retailResult.some((r) => r.check === "no_investment_advice")).toBe(false);
    expect(softwareResult.some((r) => r.check === "no_investment_advice")).toBe(false);
    expect(retailResult.every((r) => r.passed)).toBe(true);
    expect(softwareResult.every((r) => r.passed)).toBe(true);
  });
});
