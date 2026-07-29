import { Router } from "express";
import { getAgentRunById } from "../../db/repos/agentRunsRepo.js";
import { sendError } from "../errorEnvelope.js";
import { requirePermission } from "../middleware/permissions.js";
import { roleHasPermission } from "../../domain/permissions.js";

export const agentRunsRouter = Router();

// LLD §4.11: full trace incl. guardrail_results and rejected_output if
// present. V2-2 (LLD_v2 §3): rejected_output — the discarded model draft
// that L3 fail-closed on — is manager+ only; an agent sees everything else
// on the trace (status, guardrail_results, retrieved_doc_ids) but not the
// draft the model actually produced.
agentRunsRouter.get("/:runId", requirePermission("runs:view"), async (req, res, next) => {
  try {
    const run = await getAgentRunById(req.params.runId);
    if (!run) {
      sendError(res, "NOT_FOUND", `Agent run ${req.params.runId} not found`);
      return;
    }
    const canViewRejectedOutput = roleHasPermission(req.user!.role, "runs:view_rejected_output");
    res.status(200).json({
      data: canViewRejectedOutput ? run : { ...run, rejected_output: null },
    });
  } catch (err) {
    next(err);
  }
});
