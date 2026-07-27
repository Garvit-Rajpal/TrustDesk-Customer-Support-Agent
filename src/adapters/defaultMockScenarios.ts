// Canned triage responses for the app's default MockModelAdapter instance
// (wired in app.ts until the real OpenRouterAdapter lands in milestone 9).
// Authored independently by reading each seed ticket's body — NOT copied
// from ticket_expected_labels, which production code must never read
// (HLD invariant #4). For tkt_9005-9007 the model is deliberately written
// as if "fooled" by the injection (should_escalate: false) so the
// deterministic override in TriageService is what's actually proven to work
// end-to-end, not a model that already happened to guess escalate=true.
import type { MockResponseSpec } from "./mock.js";

function triage(spec: {
  category: string;
  priority: string;
  sentiment: string;
  should_escalate: boolean;
  reason_summary: string;
}): MockResponseSpec {
  return { content: JSON.stringify(spec) };
}

export const DEFAULT_TRIAGE_SCENARIOS: Record<string, MockResponseSpec> = {
  tkt_9001: triage({
    category: "refund",
    priority: "medium",
    sentiment: "frustrated",
    should_escalate: false,
    reason_summary: "Damaged item reported within the return window; replacement or refund review applies.",
  }),
  tkt_9002: triage({
    category: "shipping",
    priority: "high",
    sentiment: "frustrated",
    should_escalate: false,
    reason_summary: "Stale tracking for 6 business days; carrier investigation is the next step.",
  }),
  tkt_9003: triage({
    category: "refund",
    priority: "low",
    sentiment: "neutral",
    should_escalate: false,
    reason_summary: "Refund requested for a final-sale software license; not eligible per policy.",
  }),
  tkt_9004: triage({
    category: "warranty",
    priority: "urgent",
    sentiment: "anxious",
    should_escalate: true,
    reason_summary: "Battery swelling is a safety hazard; escalate regardless of warranty status.",
  }),
  tkt_9005: triage({
    category: "account_security",
    priority: "high",
    sentiment: "neutral",
    should_escalate: false, // deliberately "fooled" — override forces true
    reason_summary: "Account email change requested; verification not yet confirmed.",
  }),
  tkt_9006: triage({
    category: "general",
    priority: "medium",
    sentiment: "neutral",
    should_escalate: false, // deliberately "fooled" by the injection
    reason_summary: "Customer asked for a coupon.",
  }),
  tkt_9007: triage({
    category: "account_security",
    priority: "high",
    sentiment: "neutral",
    should_escalate: false, // deliberately "fooled" — override forces true
    reason_summary: "Customer asked a pre-answer question.",
  }),
  tkt_9008: triage({
    category: "billing",
    priority: "high",
    sentiment: "frustrated",
    should_escalate: false,
    reason_summary: "Duplicate charge on a single order; billing investigation needed.",
  }),
};
