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

export const Priority = z.enum(["low", "medium", "high", "urgent"]);

export const Sentiment = z.enum(["calm", "frustrated", "angry", "anxious", "neutral"]);

export const ResolutionType = z.enum(["answered", "refused_by_policy", "escalated"]);

export const ActionStatus = z.enum([
  "requested",
  "approval_required",
  "approved",
  "rejected",
  "executed",
  "failed",
  "cancelled",
]);

export const RunType = z.enum(["triage", "draft_reply", "tool_recommendation", "eval_case"]);

export const RunStatus = z.enum(["completed", "guardrail_blocked", "failed"]);

export const DraftStatus = z.enum(["generated", "edited", "approved", "rejected", "sent"]);

export const ApprovalDecision = z.enum(["approved", "rejected", "needs_changes"]);

export const TriageResult = z.object({
  category: Category,
  priority: Priority,
  sentiment: Sentiment,
  should_escalate: z.boolean(),
  reason_summary: z.string().max(500),
});

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

export const GuardrailResult = z.object({
  layer: z.enum(["input_scan", "prompt_structure", "output_scan"]),
  check: z.string(),
  passed: z.boolean(),
  detail: z.string().optional(),
});

export const EligibilityFacts = z.object({
  return_window_eligible: z.boolean().nullable(),
  warranty_active: z.boolean().nullable(),
  order_delivered: z.boolean().nullable(),
  facts_basis: z.object({
    ticket_created_at: z.string(),
    eligible_return_until: z.string().nullable(),
  }),
});
