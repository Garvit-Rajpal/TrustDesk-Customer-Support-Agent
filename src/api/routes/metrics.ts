import { Router } from "express";
import { getCategorizedFeedback } from "../../db/repos/feedbackRepo.js";
import { getCategorizedApprovals } from "../../db/repos/approvalsRepo.js";
import { getCategorizedDraftRuns } from "../../db/repos/agentRunsRepo.js";
import { computeQualityMetrics } from "../../services/qualityMetrics.js";
import { requirePermission } from "../middleware/permissions.js";

export const metricsRouter = Router();

// V2-3 (LLD_v2 §4/§9, manager+): draft_acceptance_rate/avg_rating from
// feedback, action_approval_rate from approvals, guardrail_block_rate from
// agent_runs, all broken down by ticket category — computeQualityMetrics is
// the pure, unit-tested math (src/services/qualityMetrics.ts); this route
// is just the three fetches that feed it.
metricsRouter.get("/agent-quality", requirePermission("metrics:view"), async (_req, res, next) => {
  try {
    const [feedback, approvals, agentRuns] = await Promise.all([
      getCategorizedFeedback(),
      getCategorizedApprovals(),
      getCategorizedDraftRuns(),
    ]);
    const report = computeQualityMetrics({ feedback, approvals, agentRuns });
    res.status(200).json({ data: report });
  } catch (err) {
    next(err);
  }
});
