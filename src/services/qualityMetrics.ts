// V2-3 (LLD_v2 §4): pure aggregation over already-categorized rows — no DB
// access here (that's src/db/repos/*QualityRows fetchers). Mirrors
// evalScorer.ts's split: repos fetch, this scores, so the math is
// unit-testable on hand-built fixtures without a database.
export interface CategorizedFeedback {
  category: string;
  rating: number;
}

export interface CategorizedApproval {
  category: string;
  decision: "approved" | "rejected" | "needs_changes";
}

export interface CategorizedAgentRun {
  category: string;
  status: "completed" | "guardrail_blocked" | "failed";
}

export interface CategoryMetrics {
  draft_acceptance_rate: number | null;
  action_approval_rate: number | null;
  avg_rating: number | null;
  guardrail_block_rate: number | null;
}

export interface QualityReport extends CategoryMetrics {
  by_category: Record<string, CategoryMetrics>;
}

const ACCEPTANCE_THRESHOLD = 4;

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function metricsFor(
  feedback: CategorizedFeedback[],
  approvals: CategorizedApproval[],
  agentRuns: CategorizedAgentRun[]
): CategoryMetrics {
  const ratings = feedback.map((f) => f.rating);
  const avg_rating = ratings.length === 0 ? null : ratings.reduce((a, b) => a + b, 0) / ratings.length;
  const draft_acceptance_rate = rate(
    feedback.filter((f) => f.rating >= ACCEPTANCE_THRESHOLD).length,
    feedback.length
  );
  const action_approval_rate = rate(
    approvals.filter((a) => a.decision === "approved").length,
    approvals.length
  );
  const guardrail_block_rate = rate(
    agentRuns.filter((r) => r.status === "guardrail_blocked").length,
    agentRuns.length
  );
  return { draft_acceptance_rate, action_approval_rate, avg_rating, guardrail_block_rate };
}

export function computeQualityMetrics(input: {
  feedback: CategorizedFeedback[];
  approvals: CategorizedApproval[];
  agentRuns: CategorizedAgentRun[];
}): QualityReport {
  const overall = metricsFor(input.feedback, input.approvals, input.agentRuns);

  const categories = new Set<string>([
    ...input.feedback.map((f) => f.category),
    ...input.approvals.map((a) => a.category),
    ...input.agentRuns.map((r) => r.category),
  ]);

  const by_category: Record<string, CategoryMetrics> = {};
  for (const category of categories) {
    by_category[category] = metricsFor(
      input.feedback.filter((f) => f.category === category),
      input.approvals.filter((a) => a.category === category),
      input.agentRuns.filter((r) => r.category === category)
    );
  }

  return { ...overall, by_category };
}
