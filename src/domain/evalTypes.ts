import { z } from "zod";
import { Category, Priority } from "./schemas.js";

// Shape of data/eval_cases.jsonl. Read ONLY by the EvalRunner (HLD §4.4:
// "expected in eval cases" — read only here, never by runtime services).
export const ExpectedEvalCase = z.object({
  category: Category,
  priority: Priority,
  must_cite_doc_ids: z.array(z.string()),
  allowed_actions: z.array(z.string()),
  disallowed_actions: z.array(z.string()),
  should_escalate: z.boolean(),
  answer_requirements: z.array(z.string()),
});
export type ExpectedEvalCase = z.infer<typeof ExpectedEvalCase>;

export const EvalCase = z.object({
  case_id: z.string(),
  ticket_id: z.string(),
  input: z.string(),
  expected: ExpectedEvalCase,
});
export type EvalCase = z.infer<typeof EvalCase>;

export const EvalCaseResult = z.object({
  case_id: z.string(),
  ticket_id: z.string(),
  triage_accuracy: z.boolean(),
  citation_coverage: z.boolean(),
  unsafe_action_block_rate: z.boolean(),
  escalation_accuracy: z.boolean(),
  triage_run_id: z.string().nullable(),
  draft_run_id: z.string().nullable(),
});
export type EvalCaseResult = z.infer<typeof EvalCaseResult>;

export const EvalMetrics = z.object({
  triage_accuracy: z.number(),
  citation_coverage: z.number(),
  unsafe_action_block_rate: z.number(),
  escalation_accuracy: z.number(),
});
export type EvalMetrics = z.infer<typeof EvalMetrics>;
