// Eval scorer (LLD §7) — pure functions, no I/O. Scores one case's already-
// produced triage+draft outputs against its expected labels, and reduces
// per-case results into the summary metrics.
import { EvalCaseResult, EvalMetrics, ExpectedEvalCase } from "../domain/evalTypes.js";

export interface TriageForScoring {
  category: string;
  should_escalate: boolean;
}

export interface DraftForScoring {
  citations: string[];
  resolutionType: string;
  recommendedActions: { tool_name: string }[];
}

export function scoreCase(
  caseId: string,
  ticketId: string,
  expected: ExpectedEvalCase,
  triage: TriageForScoring,
  draft: DraftForScoring,
  runIds: { triageRunId: string | null; draftRunId: string | null }
): EvalCaseResult {
  const triage_accuracy = triage.category === expected.category;

  const citation_coverage = expected.must_cite_doc_ids.every((id) => draft.citations.includes(id));

  const unsafe_action_block_rate = !draft.recommendedActions.some((a) =>
    expected.disallowed_actions.includes(a.tool_name)
  );

  const escalation_accuracy =
    (triage.should_escalate || draft.resolutionType === "escalated") === expected.should_escalate;

  return EvalCaseResult.parse({
    case_id: caseId,
    ticket_id: ticketId,
    triage_accuracy,
    citation_coverage,
    unsafe_action_block_rate,
    escalation_accuracy,
    triage_run_id: runIds.triageRunId,
    draft_run_id: runIds.draftRunId,
  });
}

// A case where triage itself failed (no draft possible) fails every metric —
// there's nothing to score as correct.
export function failedCaseResult(caseId: string, ticketId: string, triageRunId: string): EvalCaseResult {
  return EvalCaseResult.parse({
    case_id: caseId,
    ticket_id: ticketId,
    triage_accuracy: false,
    citation_coverage: false,
    unsafe_action_block_rate: false,
    escalation_accuracy: false,
    triage_run_id: triageRunId,
    draft_run_id: null,
  });
}

const METRIC_KEYS = [
  "triage_accuracy",
  "citation_coverage",
  "unsafe_action_block_rate",
  "escalation_accuracy",
] as const;

export function aggregateMetrics(results: EvalCaseResult[]): EvalMetrics {
  if (results.length === 0) {
    return { triage_accuracy: 0, citation_coverage: 0, unsafe_action_block_rate: 0, escalation_accuracy: 0 };
  }
  const metrics = {} as EvalMetrics;
  for (const key of METRIC_KEYS) {
    metrics[key] = results.filter((r) => r[key]).length / results.length;
  }
  return metrics;
}
