// V3-7 (LLD_v3 §5, HLD_v3 ADR-17): pure aggregation of three already-tested
// building blocks (ticket counts, quality metrics, latest eval run) into the
// single response the dashboard home page renders. No new business rules.
import type { OrgContext } from "../domain/orgContext.js";
import { countTicketsByStatus } from "../db/repos/ticketsRepo.js";
import { getCategorizedFeedback } from "../db/repos/feedbackRepo.js";
import { getCategorizedApprovals } from "../db/repos/approvalsRepo.js";
import { getCategorizedDraftRuns } from "../db/repos/agentRunsRepo.js";
import { getLatestEvalRun } from "../db/repos/evalRunsRepo.js";
import { computeQualityMetrics } from "./qualityMetrics.js";

export type EvalSummary =
  | { available: false }
  | {
      available: true;
      eval_run_id: string;
      completed_at: string | null;
      metrics: unknown;
    };

export interface DashboardSummary {
  tickets_by_status: Record<string, number>;
  quality: ReturnType<typeof computeQualityMetrics>;
  eval_summary: EvalSummary;
}

// LLD_v3 §5: eval_summary.available is false for every org except
// org_default — the eval runner stays hardcoded to org_default (v2's
// EVAL_ORG, unchanged in v3), a known, carried-forward limitation surfaced
// explicitly here rather than hidden.
export async function getDashboardSummary(ctx: OrgContext): Promise<DashboardSummary> {
  const [ticketsByStatus, feedback, approvals, agentRuns] = await Promise.all([
    countTicketsByStatus(ctx),
    getCategorizedFeedback(ctx),
    getCategorizedApprovals(ctx),
    getCategorizedDraftRuns(ctx),
  ]);
  const quality = computeQualityMetrics({ feedback, approvals, agentRuns });

  let evalSummary: EvalSummary = { available: false };
  if (ctx.org_id === "org_default") {
    const latest = await getLatestEvalRun(ctx);
    if (latest) {
      evalSummary = {
        available: true,
        eval_run_id: latest.eval_run_id,
        completed_at: latest.completed_at,
        metrics: latest.metrics,
      };
    }
  }

  return { tickets_by_status: ticketsByStatus, quality, eval_summary: evalSummary };
}
