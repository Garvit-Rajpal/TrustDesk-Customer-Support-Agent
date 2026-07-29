// Domain zod schemas — the single source of truth for enums and payload
// shapes (LLD §3 and CLAUDE.md conventions). DB CHECK constraints mirror
// these; TS types are inferred from these schemas via types.ts.
import { z } from "zod";

export const Category = z.enum([
  "shipping",
  "refund",
  "warranty",
  "billing",
  "account_security",
  "general",
]);
export type Category = z.infer<typeof Category>;

export const Priority = z.enum(["low", "medium", "high", "urgent"]);
export type Priority = z.infer<typeof Priority>;

export const Sentiment = z.enum(["calm", "frustrated", "angry", "anxious", "neutral"]);
export type Sentiment = z.infer<typeof Sentiment>;

export const ResolutionType = z.enum(["answered", "refused_by_policy", "escalated"]);
export type ResolutionType = z.infer<typeof ResolutionType>;

export const ActionStatus = z.enum([
  "requested",
  "approval_required",
  "approved",
  "rejected",
  "executed",
  "failed",
  "cancelled",
]);
export type ActionStatus = z.infer<typeof ActionStatus>;

export const RunType = z.enum(["triage", "draft_reply", "tool_recommendation", "eval_case"]);
export type RunType = z.infer<typeof RunType>;

export const RunStatus = z.enum(["completed", "guardrail_blocked", "failed"]);
export type RunStatus = z.infer<typeof RunStatus>;

export const DraftStatus = z.enum(["generated", "edited", "approved", "rejected", "sent"]);
export type DraftStatus = z.infer<typeof DraftStatus>;

// V2-4 (LLD_v2 §1/§5): replaces the free-text ticket.status. Legal
// transitions are enforced by src/services/ticketStatus.ts, not by this
// enum alone — this just names the reachable states.
export const TicketStatus = z.enum([
  "open",
  "in_progress",
  "awaiting_customer",
  "customer_replied",
  "resolved",
  "closed",
]);
export type TicketStatus = z.infer<typeof TicketStatus>;

export const MessageDirection = z.enum(["inbound", "outbound"]);
export type MessageDirection = z.infer<typeof MessageDirection>;

export const ApprovalDecision = z.enum(["approved", "rejected", "needs_changes"]);
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;

// V2-5 (LLD_v2 §1/§6): the three verticals a policy pack can be authored
// for (src/policy_packs/{vertical}/*.md). CHECK constraint on orgs.vertical
// mirrors this.
export const Vertical = z.enum(["retail_ecommerce", "software", "finance"]);
export type Vertical = z.infer<typeof Vertical>;

export const TriageResult = z.object({
  category: Category,
  priority: Priority,
  sentiment: Sentiment,
  should_escalate: z.boolean(),
  reason_summary: z.string().max(500),
});
export type TriageResult = z.infer<typeof TriageResult>;

// What the LLM returns for a draft — BEFORE guardrails (LLD §3).
// NOTE: no requires_human_approval field. The model is not asked and not
// trusted on this (HLD invariant #1 — catalog decides, never the model).
export const RawDraftOutput = z.object({
  body: z.string().min(1),
  citations: z.array(z.string()),
  resolution_type: ResolutionType,
  recommended_actions: z
    .array(
      z.object({
        tool_name: z.string(),
        reason: z.string(),
        payload_hints: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .default([]),
});
export type RawDraftOutput = z.infer<typeof RawDraftOutput>;

export const GuardrailResult = z.object({
  layer: z.enum(["input_scan", "prompt_structure", "output_scan"]),
  check: z.string(),
  passed: z.boolean(),
  detail: z.string().optional(),
});
export type GuardrailResult = z.infer<typeof GuardrailResult>;

// V2-1 (LLD_v2 §1/§2, ADR-8): the six pipeline stages any run passes
// through; a given run only emits events for the stages it actually
// executes (e.g. a triage run never reaches retrieval).
export const PipelineStage = z.enum([
  "input_scan",
  "triage",
  "retrieval",
  "eligibility",
  "draft_generation",
  "output_scan",
]);
export type PipelineStage = z.infer<typeof PipelineStage>;

export const PipelineEventStatus = z.enum(["started", "completed", "failed", "blocked"]);
export type PipelineEventStatus = z.infer<typeof PipelineEventStatus>;

// Redacted, allowlisted payload only (LLD_v2 §2 redaction contract) — see
// redactSummary(), the single gate that enforces this shape at runtime.
export const EventSummary = z
  .object({
    doc_ids: z.array(z.string()).optional(),
    check: z.string().optional(),
    passed: z.boolean().optional(),
    category: z.string().optional(),
    resolution_type: z.string().optional(),
    counts: z.record(z.string(), z.number()).optional(),
    durations: z.record(z.string(), z.number()).optional(),
  })
  .strict();
export type EventSummary = z.infer<typeof EventSummary>;

export const RunEvent = z.object({
  run_id: z.string(),
  stage: PipelineStage,
  status: PipelineEventStatus,
  summary: EventSummary,
  ts: z.string(),
});
export type RunEvent = z.infer<typeof RunEvent>;

export const EligibilityFacts = z.object({
  return_window_eligible: z.boolean().nullable(),
  warranty_active: z.boolean().nullable(),
  order_delivered: z.boolean().nullable(),
  facts_basis: z.object({
    ticket_created_at: z.string(),
    eligible_return_until: z.string().nullable(),
  }),
});
export type EligibilityFacts = z.infer<typeof EligibilityFacts>;
